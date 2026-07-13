"""The contract every game on the platform implements."""

from __future__ import annotations

from abc import ABC, abstractmethod


class InvalidMove(Exception):
    """Raised when a player submits a move the game cannot accept."""


class Game(ABC):
    """A single round of a game.

    The platform owns players and turn order; a subclass owns the board and the
    rules. Subclasses implement _apply, _winner_index and public_state, and
    declare key/title/min_players/max_players as class attributes.
    """

    key: str
    title: str
    min_players: int
    max_players: int

    def __init__(self) -> None:
        self.players: list[str] = []
        self.turn: int = 0
        self.over: bool = False
        self.winner: str | None = None

    # -- players ---------------------------------------------------------

    @property
    def is_full(self) -> bool:
        return len(self.players) >= self.max_players

    @property
    def can_start(self) -> bool:
        return len(self.players) >= self.min_players

    def add_player(self, player_id: str) -> None:
        if self.is_full:
            raise InvalidMove("game is full")
        if player_id in self.players:
            raise InvalidMove("already in this game")
        self.players.append(player_id)

    # -- moves -----------------------------------------------------------

    def apply_move(self, player_id: str, move: dict) -> None:
        """Validate turn order, then hand off to the subclass."""
        if self.over:
            raise InvalidMove("game is over")
        if not self.can_start:
            raise InvalidMove("waiting for another player")
        if player_id not in self.players:
            raise InvalidMove("you are not a player in this game")
        if self.players[self.turn] != player_id:
            raise InvalidMove("not your turn")

        self._apply(self.players.index(player_id), move)

        winner_index = self._winner_index()
        if winner_index is not None:
            self.over = True
            self.winner = self.players[winner_index]
        elif self._is_draw():
            self.over = True
            self.winner = None
        else:
            self.turn = (self.turn + 1) % len(self.players)

    @abstractmethod
    def _apply(self, seat: int, move: dict) -> None:
        """Apply a legal-by-turn-order move, or raise InvalidMove."""

    @abstractmethod
    def _winner_index(self) -> int | None:
        """Seat index of the winner, or None if nobody has won yet."""

    @abstractmethod
    def _is_draw(self) -> bool:
        """True when the game is over with no winner."""

    @abstractmethod
    def public_state(self) -> dict:
        """Everything the frontend needs to draw the board."""
