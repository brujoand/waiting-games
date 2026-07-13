"""In-memory game sessions. A restart drops every live game."""

from __future__ import annotations

import asyncio
import contextlib
import secrets
import time
from dataclasses import dataclass, field

from .auth import Player
from .games import GAMES, Game, InvalidMove

# A game nobody ever joined, a game long since finished, and a game everyone
# walked away from mid-play are all garbage.
WAITING_TTL = 30 * 60
FINISHED_TTL = 5 * 60
EMPTY_TTL = 60
REAP_INTERVAL = 60
MAX_SESSIONS = 100

# A real-time game never integrates more than this many frames' worth of time in
# one tick, however long the event loop was away.
TICK_CATCHUP = 3

# The keys the platform puts in every state payload. A game's view() is merged
# over these, so a game returning one of them would silently clobber the platform
# and break the lobby in a way that looks like a frontend bug. Tested, not
# promised -- see test_no_game_view_collides_with_a_platform_key.
RESERVED_KEYS = frozenset(
    {
        "id",
        "game",
        "status",
        "host",
        "hostSub",
        "players",
        "seats",
        "joinable",
        "canStart",
        "playerNames",
        "seat",
        "turn",
        "over",
        "winner",
        "draw",
        "connected",
    }
)


@dataclass
class Session:
    id: str
    game_key: str
    engine: Game
    host: str
    players: dict[str, Player] = field(default_factory=dict)
    created_at: float = field(default_factory=time.monotonic)
    finished_at: float | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    sockets: set = field(default_factory=set)

    # When the last socket left. A started game nobody is watching is neither
    # waiting nor finished, so without this it would never be reaped.
    empty_since: float | None = field(default_factory=time.monotonic)

    # A real-time game's clock, and the gate that stops it while nobody watches.
    tick_task: asyncio.Task | None = None
    watchers: asyncio.Event = field(default_factory=asyncio.Event)
    # Sockets with a frame still in flight. A real-time game skips them rather
    # than waiting -- see Lobby.stream.
    sending: set = field(default_factory=set)

    @property
    def status(self) -> str:
        if self.engine.over:
            return "finished"
        return "active" if self.engine.started else "waiting"

    def summary(self) -> dict:
        """The shape the lobby list renders."""
        return {
            "id": self.id,
            "game": self.game_key,
            # No `title`. It would be English, and the browser names the game from
            # `game` (its key) in the player's own language. Shipping a field the
            # client is forbidden to render is a trap someone eventually springs.
            "status": self.status,
            "host": self.players[self.host].name if self.host in self.players else "?",
            # A display name is not an identity: the client needs the sub to know
            # whether to show itself a Start button.
            "hostSub": self.host,
            "players": [p.name for p in self.players.values()],
            "seats": f"{len(self.players)}/{self.engine.max_players}",
            "joinable": self.status == "waiting" and not self.engine.is_full,
            "canStart": self.engine.can_start,
        }

    def state(self, seat: int | None) -> dict:
        """The game as this seat is allowed to see it. seat None is a spectator."""
        engine = self.engine
        turn = (
            None
            if engine.realtime or engine.over or not engine.started
            else engine.players[engine.turn]
        )
        return {
            **self.summary(),
            "playerNames": {p.sub: p.name for p in self.players.values()},
            "seat": seat,
            "turn": turn,
            "over": engine.over,
            "winner": engine.winner,
            "draw": engine.over and engine.winner is None,
            "connected": [sub for sub, _ in self.sockets],
            **engine.view(seat),
        }

    def frames(self) -> dict[int | None, dict]:
        """One payload per distinct seat watching, not one per socket."""
        seats = {self.engine.seat_of(sub) for sub, _ in self.sockets}
        return {seat: {"type": "state", "data": self.state(seat)} for seat in seats}

    def note_sockets_changed(self) -> None:
        if self.sockets:
            self.empty_since = None
            self.watchers.set()
        else:
            self.empty_since = time.monotonic()
            self.watchers.clear()  # a real-time clock parks itself on this


def loop_is_running() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


class Lobby:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}
        self.lobby_sockets: set = set()
        # Evictions in flight. asyncio keeps only a WEAK reference to a task, so
        # a fire-and-forget one can be collected before it has run; holding it
        # here is what keeps it alive. See drop().
        self.evictions: set[asyncio.Task] = set()

    # -- sessions --------------------------------------------------------

    def require(self, session_id: str) -> Session:
        session = self.sessions.get(session_id)
        if session is None:
            raise InvalidMove("lobby.no_such_game")
        return session

    def create(self, game_key: str, player: Player) -> Session:
        if game_key not in GAMES:
            raise InvalidMove("lobby.unknown_game", game=game_key)

        # One open game per host: starting a new one abandons the old.
        for existing in [s for s in self.sessions.values() if s.host == player.sub]:
            if existing.status == "waiting":
                self.drop(existing.id)

        self.reap()
        if len(self.sessions) >= MAX_SESSIONS:
            raise InvalidMove("lobby.too_many_games")

        engine = GAMES[game_key]()
        engine.add_player(player.sub)
        session = Session(
            id=secrets.token_urlsafe(6),
            game_key=game_key,
            engine=engine,
            host=player.sub,
            players={player.sub: player},
        )
        self.sessions[session.id] = session
        return session

    def join(self, session_id: str, player: Player) -> Session:
        session = self.require(session_id)
        if player.sub in session.players:
            return session  # rejoining your own game is a no-op, not an error

        session.engine.add_player(player.sub)
        session.players[player.sub] = player

        # Nobody else can get in, so there is nothing left to wait for.
        if session.engine.is_full:
            self._start(session)
        return session

    def begin(self, session_id: str, player: Player) -> Session:
        """The host starts early, without waiting for the game to fill up."""
        session = self.require(session_id)
        if session.host != player.sub:
            raise InvalidMove("lobby.not_host")
        self._start(session)
        return session

    def close(self, session_id: str, player: Player) -> None:
        """The host deletes their own game, at any stage of its life.

        Deliberately not restricted to a game that has not started: the reason to
        want this is a game that IS stuck -- an opponent who wandered off mid-play,
        a board nobody is coming back to. The reaper would get it eventually, but
        "eventually" is a minute of staring at a lobby full of your own litter.

        drop() is what tells the other players; see there.
        """
        session = self.require(session_id)
        if session.host != player.sub:
            raise InvalidMove("lobby.not_host")
        self.drop(session_id)

    def _start(self, session: Session) -> None:
        """Start the game and give everyone a fresh window to connect.

        Restarting the empty-clock here is load-bearing. It is set when the
        session is CREATED, and a game can sit in the lobby for many minutes
        before an opponent turns up -- so by the time a join auto-starts it, the
        clock is long past EMPTY_TTL and the reaper would delete a game that has
        this instant begun, before either player's socket has attached.
        "Never watched yet" and "watched, then abandoned" need different clocks.
        """
        session.engine.start()
        session.note_sockets_changed()

    def listing(self) -> list[dict]:
        return [s.summary() for s in self.sessions.values() if s.status != "finished"]

    # -- broadcast -------------------------------------------------------

    async def broadcast_state(self, session: Session) -> None:
        await self.fanout(session, session.frames())

    async def fanout(self, session: Session, frames: dict[int | None, dict]) -> None:
        """Give every socket the frame for its seat.

        Concurrently: one client with a full TCP window must not delay the rest.
        NEVER call this while holding session.lock -- apply_move takes the same
        lock, so a slow socket would turn into input lag for every player.

        `frames` is a snapshot taken under the lock, so a socket that connected
        after it was built has no frame here. Skip it: its own connect broadcast
        is already on its way, and looking the seat up blindly would KeyError and
        tear down the handler of whoever happened to be moving.
        """
        entries = [
            (sub, websocket)
            for sub, websocket in session.sockets
            if session.engine.seat_of(sub) in frames
        ]
        if not entries:
            return

        results = await asyncio.gather(
            *(
                websocket.send_json(frames[session.engine.seat_of(sub)])
                for sub, websocket in entries
            ),
            return_exceptions=True,
        )
        # gather() preserves order and length, so these zip 1:1 by construction.
        for entry, result in zip(entries, results, strict=True):
            if isinstance(result, Exception):  # a dead socket is not an error
                session.sockets.discard(entry)
        session.note_sockets_changed()

    def stream(self, session: Session, frames: dict[int | None, dict]) -> None:
        """Push a frame at every socket WITHOUT waiting for any of them.

        This is what the clock uses, and the difference from fanout() is the
        whole reason it exists. fanout() gathers, so it does not return until the
        slowest socket in the room has taken its frame -- and the clock awaits it,
        so one player on a flaky connection would freeze the match for everybody
        else, every tick, for as long as their send took to fail.

        Here each socket carries at most one frame at a time, and a socket still
        busy with the last one simply MISSES this one. A real-time game would far
        rather drop a frame for a slow client than hold the whole room to its
        pace; the client is painting from its own rAF loop and will never notice.
        """
        for entry in list(session.sockets):
            sub, websocket = entry
            seat = session.engine.seat_of(sub)
            if seat not in frames or websocket in session.sending:
                continue
            session.sending.add(websocket)
            asyncio.create_task(self._deliver(session, entry, frames[seat]))

    async def _deliver(self, session: Session, entry, frame: dict) -> None:
        websocket = entry[1]
        try:
            await websocket.send_json(frame)
        except Exception:  # noqa: BLE001 - a dead socket is not an error
            session.sockets.discard(entry)
            session.note_sockets_changed()
        finally:
            session.sending.discard(websocket)

    async def broadcast_lobby(self) -> None:
        """The lobby listing genuinely is the same for everyone."""
        message = {"type": "sessions", "data": self.listing()}
        for entry in list(self.lobby_sockets):
            _, websocket = entry
            try:
                await websocket.send_json(message)
            except Exception:  # noqa: BLE001 - a dead socket is not an error
                self.lobby_sockets.discard(entry)

    # -- the clock, for real-time games -----------------------------------

    async def launch(self, session: Session) -> None:
        """Give a started real-time game a clock. A no-op for everything else.

        Separate from _start because _start is called from synchronous code (and
        from tests, where there is no event loop to create a task on).
        """
        if not session.engine.realtime or not session.engine.started:
            return
        if session.tick_task is None:
            session.tick_task = asyncio.create_task(self._tick_forever(session))

    async def _tick_forever(self, session: Session) -> None:
        engine = session.engine
        interval = 1.0 / engine.tick_hz
        longest_frame = interval * TICK_CATCHUP
        loop = asyncio.get_running_loop()

        try:
            last = loop.time()
            next_at = last + interval

            while True:
                # Nobody is watching: park the clock rather than simulate into an
                # empty room. This costs ZERO cpu, not "a little" -- and a player
                # who reloads the page does not come back to a corpse. If they
                # never come back, the reaper collects the session and cancels us.
                if not session.sockets:
                    await session.watchers.wait()
                    last = (
                        loop.time()
                    )  # the pause never happened, as far as the world knows
                    next_at = last + interval

                await asyncio.sleep(max(0.0, next_at - loop.time()))
                now = loop.time()

                # Clamp. A garbage collection pause, a slow broadcast, or a
                # laptop lid must not integrate a huge dt and teleport the ball
                # straight through a paddle.
                dt = min(now - last, longest_frame)
                last = now
                # Schedule against a fixed grid, but never try to catch up on a
                # backlog: drop the frames instead of spiralling.
                next_at = max(next_at + interval, now)

                async with session.lock:
                    if engine.over:
                        break
                    engine.tick(dt)
                    frames = session.frames()

                # Outside the lock, and WITHOUT waiting: the clock must not be
                # serialised on the slowest socket in the room. See stream().
                self.stream(session, frames)

            # The last frame carries the result, so this one we do wait for.
            await self.broadcast_state(session)
            await self.broadcast_lobby()
        finally:
            session.tick_task = None

    # -- reaping ---------------------------------------------------------

    def reap(self) -> int:
        now = time.monotonic()
        stale = []

        for session in self.sessions.values():
            if session.engine.over:
                if session.finished_at is None:
                    session.finished_at = now
                elif now - session.finished_at > FINISHED_TTL:
                    stale.append(session.id)
            elif session.engine.started:
                # Everyone closed the tab mid-game; nothing will ever finish it.
                empty = session.empty_since
                if empty is not None and now - empty > EMPTY_TTL:
                    stale.append(session.id)
            elif now - session.created_at > WAITING_TTL:
                stale.append(session.id)

        for session_id in stale:
            self.drop(session_id)
        return len(stale)

    def drop(self, session_id: str) -> None:
        """Forget a session, stop its clock, and hang up on whoever is watching.

        EVERY way a session dies comes through here -- the host closing it, the
        reaper collecting it, a new game superseding the host's old waiting one --
        which is why the eviction belongs here and not in close(). A watcher whose
        session is merely popped out of the dict is left staring at a board the
        lobby has forgotten, waiting for a state push that can now never come.
        Before this, opening a second game in another tab did exactly that to the
        first one.

        A tick task holds a reference to its session, so dropping the session
        without cancelling the task would leave it ticking an orphan forever.
        """
        session = self.sessions.pop(session_id, None)
        if session is None:
            return

        if session.tick_task is not None:
            session.tick_task.cancel()

        # Hanging up has to await a send, and drop() is called from synchronous
        # code (create, reap). Off to the loop with it -- and if there is no loop
        # there is no socket either, because a socket only exists inside one.
        if session.sockets and loop_is_running():
            task = asyncio.create_task(self.evict(session))
            self.evictions.add(task)
            task.add_done_callback(self.evictions.discard)

    async def evict(self, session: Session) -> None:
        """Tell everyone watching that the game is gone, and hang up.

        The frame first, then the close: the client needs to know WHY it was cut
        off. A bare disconnect is indistinguishable from the server restarting,
        and it would send them round the reconnect path instead of back to the
        lobby with an explanation.
        """
        message = {"type": "closed", "data": {"code": "lobby.game_closed"}}

        for entry in list(session.sockets):
            session.sockets.discard(entry)
            _, websocket = entry
            with contextlib.suppress(Exception):  # a dead socket is not an error
                await websocket.send_json(message)
                await websocket.close()

        session.note_sockets_changed()

    async def drain(self) -> None:
        """Settle every eviction in flight. For tests, and for a tidy shutdown."""
        while self.evictions:
            await asyncio.gather(*self.evictions, return_exceptions=True)

    def shutdown(self) -> None:
        for session_id in list(self.sessions):
            self.drop(session_id)
