"""In-memory game sessions. A restart drops every live game."""

from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass, field

from .auth import Player
from .games import GAMES, Game, InvalidMove

# A game nobody ever joined, and a game long since finished, are both garbage.
WAITING_TTL = 30 * 60
FINISHED_TTL = 5 * 60
MAX_SESSIONS = 100


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

    @property
    def status(self) -> str:
        if self.engine.over:
            return "finished"
        return "active" if self.engine.can_start else "waiting"

    def summary(self) -> dict:
        """The shape the lobby list renders."""
        return {
            "id": self.id,
            "game": self.game_key,
            "title": self.engine.title,
            "status": self.status,
            "host": self.players[self.host].name if self.host in self.players else "?",
            "players": [p.name for p in self.players.values()],
            "seats": f"{len(self.players)}/{self.engine.max_players}",
            "joinable": self.status == "waiting" and not self.engine.is_full,
        }

    def state(self) -> dict:
        """Full game state, pushed to both players on every change."""
        engine = self.engine
        turn = (
            engine.players[engine.turn] if engine.players and not engine.over else None
        )
        return {
            **self.summary(),
            "playerNames": {p.sub: p.name for p in self.players.values()},
            "turn": turn,
            "over": engine.over,
            "winner": engine.winner,
            "draw": engine.over and engine.winner is None,
            "connected": [sub for sub, _ in self.sockets],
            **engine.public_state(),
        }


class Lobby:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}
        self.lobby_sockets: set = set()

    # -- sessions --------------------------------------------------------

    def create(self, game_key: str, player: Player) -> Session:
        if game_key not in GAMES:
            raise InvalidMove(f"unknown game: {game_key}")

        # One open game per host: starting a new one abandons the old.
        for existing in [s for s in self.sessions.values() if s.host == player.sub]:
            if existing.status == "waiting":
                del self.sessions[existing.id]

        self.reap()
        if len(self.sessions) >= MAX_SESSIONS:
            raise InvalidMove("too many games in progress, try again later")

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
        session = self.sessions.get(session_id)
        if session is None:
            raise InvalidMove("no such game")
        if player.sub in session.players:
            return session  # rejoining your own game is a no-op, not an error
        if session.engine.is_full:
            raise InvalidMove("game is full")
        if session.engine.over:
            raise InvalidMove("game is over")
        session.engine.add_player(player.sub)
        session.players[player.sub] = player
        return session

    def listing(self) -> list[dict]:
        return [s.summary() for s in self.sessions.values() if s.status != "finished"]

    # -- broadcast -------------------------------------------------------

    async def broadcast_state(self, session: Session) -> None:
        await _send_all(session.sockets, {"type": "state", "data": session.state()})

    async def broadcast_lobby(self) -> None:
        await _send_all(
            self.lobby_sockets, {"type": "sessions", "data": self.listing()}
        )

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
            elif (
                not session.engine.can_start and now - session.created_at > WAITING_TTL
            ):
                stale.append(session.id)
        for session_id in stale:
            del self.sessions[session_id]
        return len(stale)


async def _send_all(sockets: set, message: dict) -> None:
    """Fan a message out, dropping any socket that has gone away."""
    for entry in list(sockets):
        _, websocket = entry
        try:
            await websocket.send_json(message)
        except Exception:  # noqa: BLE001 - a dead socket is not an error worth raising
            sockets.discard(entry)
