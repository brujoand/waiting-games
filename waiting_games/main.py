"""Waiting Games - a small multiplayer game server.

Players claim a display name, get a session cookie, and play. See auth.py for
what that cookie is and is not worth.

Everything lives in memory: restart the process and every game is gone. That is
a deliberate trade for a server whose longest-lived object is a tic tac toe
board, and it is why this runs as a single instance -- two replicas behind a
load balancer would not share a lobby.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
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

from .auth import COOKIE_NAME, SESSION_TTL, InvalidName, Player, Sessions
from .games import GAMES, InvalidMove
from .lobby import Lobby

STATIC = Path(__file__).parent / "static"

# Set SECURE_COOKIE=1 when serving over HTTPS, so the session cookie is marked
# Secure and never travels in the clear. It is off by default because a Secure
# cookie is silently dropped over plain HTTP, which would make the app unusable
# on http://localhost -- a broken default is worse than an opt-in flag.
SECURE_COOKIE = os.environ.get("SECURE_COOKIE") == "1"

REAP_INTERVAL = 60

lobby = Lobby()
sessions = Sessions()


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    reaper = asyncio.create_task(reap_forever())
    try:
        yield
    finally:
        reaper.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reaper


async def reap_forever() -> None:
    while True:
        await asyncio.sleep(REAP_INTERVAL)
        sessions.reap()
        if lobby.reap():
            await lobby.broadcast_lobby()


app = FastAPI(title="Waiting Games", lifespan=lifespan)


def identify(cookies) -> Player:
    """Resolve the caller from their session cookie, or refuse to serve them."""
    player = sessions.resolve(cookies.get(COOKIE_NAME))
    if player is None:
        raise HTTPException(status_code=401, detail="not logged in")
    return player


def current_player(request: Request) -> Player:
    return identify(request.cookies)


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
    return {"ok": True}


@app.post("/api/login")
async def login(body: dict, response: Response) -> dict:
    try:
        token, player = sessions.login(body.get("name", ""))
    except InvalidName as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

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
    sessions.logout(request.cookies.get(COOKIE_NAME))
    response.delete_cookie(COOKIE_NAME, httponly=True, samesite="lax")


@app.get("/api/me")
async def me(player: Player = Depends(current_player)) -> dict:
    return {"sub": player.sub, "name": player.name}


@app.get("/api/games")
async def games() -> list[dict]:
    return [
        {"key": g.key, "title": g.title, "players": g.max_players}
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
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await lobby.broadcast_lobby()
    return session.summary()


@app.post("/api/sessions/{session_id}/join")
async def join_session(
    session_id: str, player: Player = Depends(current_player)
) -> dict:
    try:
        session = lobby.join(session_id, player)
    except InvalidMove as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await lobby.broadcast_state(session)
    await lobby.broadcast_lobby()
    return session.summary()


@app.websocket("/ws/lobby")
async def lobby_socket(websocket: WebSocket) -> None:
    try:
        player = identify(websocket.cookies)
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
        player = identify(websocket.cookies)
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
    # Anyone may watch; only seated players may move.
    await lobby.broadcast_state(session)

    try:
        while True:
            message = await receive_message(websocket)
            kind = message.get("type")

            if kind == "ping":
                await websocket.send_json({"type": "pong", "data": {}})
                continue

            if kind != "move":
                continue

            async with session.lock:
                try:
                    session.engine.apply_move(player.sub, message.get("data", {}))
                except InvalidMove as exc:
                    await websocket.send_json(
                        {"type": "error", "data": {"message": str(exc)}}
                    )
                    continue
                became_final = session.engine.over

            await lobby.broadcast_state(session)
            if became_final:
                await lobby.broadcast_lobby()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        session.sockets.discard(entry)
        # Let the other player see that their opponent dropped.
        with contextlib.suppress(Exception):
            await lobby.broadcast_state(session)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
