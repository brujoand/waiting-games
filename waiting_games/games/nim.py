"""Nim: take as many as you want from ONE pile. Whoever takes the last match wins."""

from __future__ import annotations

from .base import Game, InvalidMove, Result

STARTING_PILES = (3, 5, 7)


class Nim(Game):
    key = "nim"
    title = "Nim"
    min_players = 2
    max_players = 2

    def __init__(self) -> None:
        super().__init__()
        self.piles: list[int] = list(STARTING_PILES)
        self.took: int | None = None  # the seat that took the last match

    def _apply(self, seat: int, move: dict) -> None:
        pile, count = move.get("pile"), move.get("count")

        for value, name in ((pile, "the pile"), (count, "the count")):
            # bool is a subclass of int, so True would pass an isinstance check.
            if isinstance(value, bool) or not isinstance(value, int):
                raise InvalidMove(f"{name} must be a number")

        if not 0 <= pile < len(self.piles):
            raise InvalidMove("that pile does not exist")
        if count < 1:
            raise InvalidMove("you must take at least one match")
        if count > self.piles[pile]:
            raise InvalidMove("there aren't that many in the pile")

        self.piles[pile] -= count
        self.took = seat

    def _result(self) -> Result | None:
        if any(self.piles):
            return None
        # Whoever emptied the table took the last match, and wins.
        return Result(winner_seat=self.took)

    def public_state(self) -> dict:
        return {"piles": self.piles}
