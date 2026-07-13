"""Waiting Games - a small multiplayer game server.

Players claim a display name, get a session cookie, and play. See auth.py for
what that cookie is and is not worth.

Everything lives in memory: restart the process and every game is gone. That is
a deliberate trade for a server whose longest-lived object is a game board, and
it is why this runs as a single instance -- two behind a load balancer would not
share a lobby.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import time
from pathlib import Path

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.requests import HTTPConnection

from .auth import (
    COOKIE_NAME,
    SESSION_TTL,
    CookieIdentity,
    Identity,
    InvalidName,
    Player,
    ProxyIdentity,
    Sessions,
)
from .games import GAMES, InvalidMove
from .lobby import Lobby

STATIC = Path(__file__).parent / "static"

# Set SECURE_COOKIE=1 when serving over HTTPS, so the session cookie is marked
# Secure and never travels in the clear. It is off by default because a Secure
# cookie is silently dropped over plain HTTP, which would make the app unusable
# on http://localhost -- a broken default is worse than an opt-in flag.
SECURE_COOKIE = os.environ.get("SECURE_COOKIE") == "1"

# Take identity from the proxy's headers instead of our own cookie. Safe ONLY
# where the proxy is the sole thing that can reach this process -- read auth.py's
# module docstring before setting it. The code cannot check the precondition;
# this flag is you asserting it.
TRUSTED_PROXY_AUTH = os.environ.get("TRUSTED_PROXY_AUTH") == "1"

# Stamped into the image at build time by the Dockerfile's ARG, from the same
# version semantic-release tagged the image with. "dev" when running from a
# checkout -- and a DEPLOYED image that says "dev" is telling you its build was
# wrong, which is worth more than a confident lie.
VERSION = os.environ.get("APP_VERSION", "dev")

REAP_INTERVAL = 60

lobby = Lobby()
sessions = Sessions()  # unused, and permanently empty, in proxy mode

IDENTITY: Identity = ProxyIdentity() if TRUSTED_PROXY_AUTH else CookieIdentity(sessions)


# A real-time client sends a direction only when it CHANGES, so an honest one is
# nowhere near this even holding a key down. The bucket is a backstop, not the
# defence: the real one is that a real-time move never broadcasts, so a flood
# cannot amplify into a single extra outgoing frame.
MOVES_PER_SECOND = 20.0
MOVE_BURST = 30


class TokenBucket:
    """One per socket. Created with the connection, collected with it."""

    def __init__(self, rate: float = MOVES_PER_SECOND, burst: int = MOVE_BURST) -> None:
        self.rate = rate
        self.burst = burst
        self.tokens = float(burst)
        self.checked = time.monotonic()

    def take(self) -> bool:
        now = time.monotonic()
        self.tokens = min(self.burst, self.tokens + (now - self.checked) * self.rate)
        self.checked = now
        if self.tokens < 1.0:
            return False
        self.tokens -= 1.0
        return True


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    reaper = asyncio.create_task(reap_forever())
    try:
        yield
    finally:
        reaper.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reaper
        # Every live game's clock goes with us.
        lobby.shutdown()


async def reap_forever() -> None:
    while True:
        await asyncio.sleep(REAP_INTERVAL)
        sessions.reap()
        if lobby.reap():
            await lobby.broadcast_lobby()


app = FastAPI(title="Waiting Games", lifespan=lifespan)


def identify(conn: HTTPConnection) -> Player:
    """Resolve the caller however this deployment does identity, or refuse them.

    It takes the CONNECTION, not the cookies: Request and WebSocket both subclass
    HTTPConnection, which is where .cookies and .headers live. So this one
    function serves the HTTP dependency and both WebSocket handshakes, and there
    is no second code path for an identity rule to be forgotten in.
    """
    player = IDENTITY.identify(conn)
    if player is None:
        raise HTTPException(status_code=401, detail={"code": "auth.not_signed_in"})
    return player


def current_player(request: Request) -> Player:
    return identify(request)


async def receive_message(websocket: WebSocket) -> dict:
    """Read one message, tolerating junk.

    receive_json() raises on anything that is not JSON, and a bare JSON array
    would sail past a .get() call. Neither should be able to tear down a socket,
    so both degrade to an empty message the caller simply ignores.
    """
    try:
        message = await websocket.receive_json()
    except ValueError:  # json.JSONDecodeError
        return {}
    return message if isinstance(message, dict) else {}


@app.get("/healthz")
async def healthz() -> dict:
    # A health probe has no session, so this one route must not require identity.
    return {"ok": True}


def require_login_endpoint() -> None:
    """In proxy mode there is no name to claim: the proxy has already said who you
    are. 404, not 403 -- the endpoint does not exist in this deployment.

    Guarded here rather than by registering the route conditionally: `app` is a
    module singleton the tests import, so conditional registration would force an
    app factory or a reload, and buy nothing.
    """
    if not IDENTITY.login_enabled:
        raise HTTPException(status_code=404, detail={"code": "auth.login_disabled"})


@app.get("/api/config")
async def config() -> dict:
    """What the browser must know BEFORE it can render anything. No identity
    required -- the login screen is the thing that depends on the answer.

    It matters because of the failure path: in proxy mode a 401 from /api/me means
    the proxy did not inject its headers, and rendering a name form there would be
    actively wrong. The form would 404 on submit, and the player would be left
    filling in a box that cannot help them.

    The version rides along here rather than on a route of its own: this is
    already the unauthenticated "what is this server" endpoint, and the badge has
    to render on the sign-in screen too.
    """
    return {"authMode": IDENTITY.mode, "version": VERSION}


@app.post("/api/login")
async def login(body: dict, response: Response) -> dict:
    require_login_endpoint()
    try:
        token, player = sessions.login(body.get("name", ""))
    except InvalidName as exc:
        raise HTTPException(status_code=400, detail=exc.as_dict()) from exc

    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_TTL,
        httponly=True,
        samesite="lax",
        secure=SECURE_COOKIE,
    )
    return {"sub": player.sub, "name": player.name}


@app.post("/api/logout", status_code=204)
async def logout(request: Request, response: Response) -> None:
    # Signing out of a proxy-authenticated session means signing out of the
    # identity provider, and the proxy owns that session, not us.
    require_login_endpoint()
    sessions.logout(request.cookies.get(COOKIE_NAME))
    response.delete_cookie(COOKIE_NAME, httponly=True, samesite="lax")


@app.get("/api/me")
async def me(player: Player = Depends(current_player)) -> dict:
    return {"sub": player.sub, "name": player.name}


@app.get("/api/games")
async def games() -> list[dict]:
    return [
        {
            "key": g.key,
            # A catalogue for humans and curl. The UI must NEVER render this: it
            # is English, and the browser names the game from `key` in the
            # player's own language.
            "title": g.title,
            "minPlayers": g.min_players,
            "maxPlayers": g.max_players,
        }
        for g in GAMES.values()
    ]


@app.get("/api/sessions")
async def list_sessions(_: Player = Depends(current_player)) -> list[dict]:
    return lobby.listing()


@app.post("/api/sessions", status_code=201)
async def create_session(body: dict, player: Player = Depends(current_player)) -> dict:
    try:
        session = lobby.create(body.get("game", ""), player)
    except InvalidMove as exc:
        raise HTTPException(status_code=400, detail=exc.as_dict()) from exc
    await lobby.broadcast_lobby()
    return session.summary()


@app.post("/api/sessions/{session_id}/join")
async def join_session(
    session_id: str, player: Player = Depends(current_player)
) -> dict:
    try:
        session = lobby.join(session_id, player)
    except InvalidMove as exc:
        raise HTTPException(status_code=400, detail=exc.as_dict()) from exc
    # Filling up auto-starts the game, which for Snake or Pong means the clock
    # starts too. launch() is a no-op for anything turn-based.
    await lobby.launch(session)
    await lobby.broadcast_state(session)
    await lobby.broadcast_lobby()
    return session.summary()


@app.delete("/api/sessions/{session_id}", status_code=204)
async def close_session(
    session_id: str, player: Player = Depends(current_player)
) -> None:
    """The host throws their own game away. Anyone watching gets bounced to the
    lobby by the eviction drop() schedules -- see Lobby.drop."""
    try:
        lobby.close(session_id, player)
    except InvalidMove as exc:
        raise HTTPException(status_code=400, detail=exc.as_dict()) from exc
    await lobby.broadcast_lobby()


@app.post("/api/sessions/{session_id}/start")
async def start_session(
    session_id: str, player: Player = Depends(current_player)
) -> dict:
    """The host starts a game that is not full -- nobody else is coming."""
    try:
        session = lobby.begin(session_id, player)
    except InvalidMove as exc:
        raise HTTPException(status_code=400, detail=exc.as_dict()) from exc
    await lobby.launch(session)
    await lobby.broadcast_state(session)
    await lobby.broadcast_lobby()
    return session.summary()


@app.websocket("/ws/lobby")
async def lobby_socket(websocket: WebSocket) -> None:
    try:
        player = identify(websocket)
    except HTTPException:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    entry = (player.sub, websocket)
    lobby.lobby_sockets.add(entry)
    try:
        await websocket.send_json({"type": "sessions", "data": lobby.listing()})
        while True:
            await receive_message(websocket)  # only heartbeats arrive here
            await websocket.send_json({"type": "pong", "data": {}})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        lobby.lobby_sockets.discard(entry)


@app.websocket("/ws/sessions/{session_id}")
async def game_socket(websocket: WebSocket, session_id: str) -> None:
    try:
        player = identify(websocket)
    except HTTPException:
        await websocket.close(code=1008)
        return

    session = lobby.sessions.get(session_id)
    if session is None:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    entry = (player.sub, websocket)
    session.sockets.add(entry)
    session.note_sockets_changed()
    # Anyone may watch; only seated players may move. This is why a game with
    # secrets must make view(None) its most restricted view.
    await lobby.broadcast_state(session)

    bucket = TokenBucket()

    try:
        while True:
            message = await receive_message(websocket)
            kind = message.get("type")

            if kind == "ping":
                await websocket.send_json({"type": "pong", "data": {}})
                continue

            if kind != "move":
                continue

            if not bucket.take():
                # Drop it, silently. Answering a flood with an error frame per
                # message is how you turn a misbehaving client into an amplifier.
                continue

            realtime = session.engine.realtime

            async with session.lock:
                try:
                    session.engine.apply_move(player.sub, message.get("data", {}))
                except InvalidMove as exc:
                    # A real-time client has nothing useful to do with "you
                    # cannot reverse into yourself", and replying per rejected
                    # message is the same amplifier as above.
                    if not realtime:
                        await websocket.send_json(
                            {"type": "error", "data": exc.as_dict()}
                        )
                    continue
                became_final = session.engine.over
                # In a real-time game a move is INTENT, not action: the tick loop
                # decides when the world changes, and the tick loop broadcasts.
                # Echoing input here would let four players holding a key turn
                # into a fan-out storm, and would fight the clock for the wire.
                frames = None if realtime else session.frames()

            # Sending happens OUTSIDE the lock: fanout awaits every socket, and
            # apply_move takes the same lock, so holding it across a send would
            # turn one backpressured client into input lag for every player.
            #
            # The lock is not what makes the mutation above safe -- every engine
            # method is synchronous, so on a single-threaded event loop it cannot
            # interleave with anything (which is also why lobby.join/begin can
            # mutate the engine without taking it). The lock is here for the tick
            # loop, which mutates the engine from a background task.
            if frames is not None:
                await lobby.fanout(session, frames)
                if became_final:
                    await lobby.broadcast_lobby()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        session.sockets.discard(entry)
        session.note_sockets_changed()
        # Let the others see that someone dropped.
        with contextlib.suppress(Exception):
            await lobby.broadcast_state(session)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
