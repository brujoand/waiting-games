"""Nim: take as many as you want from ONE pile. Whoever takes the last match wins."""

from __future__ import annotations

from .base import Game, InvalidMove, Result

STARTING_PILES = (3, 5, 7)


class Nim(Game):
    key = "nim"
    title = "Nim"
    category = "board"
    min_players = 2
    max_players = 2

    def __init__(self) -> None:
        super().__init__()
        self.piles: list[int] = list(STARTING_PILES)
        self.took: int | None = None  # the seat that took the last match

    def _apply(self, seat: int, move: dict) -> None:
        pile, count = move.get("pile"), move.get("count")

        # Two codes, not one code with the noun as a param. A param may only be
        # data that needs no translation -- "the pile" is a word, and a word in a
        # param is English on the wire wearing a disguise.
        #
        # bool is a subclass of int, so True would pass an isinstance check.
        if isinstance(pile, bool) or not isinstance(pile, int):
            raise InvalidMove("nim.pile_not_a_number")
        if isinstance(count, bool) or not isinstance(count, int):
            raise InvalidMove("nim.count_not_a_number")

        if not 0 <= pile < len(self.piles):
            raise InvalidMove("nim.no_such_pile")
        if count < 1:
            raise InvalidMove("nim.take_at_least_one")
        if count > self.piles[pile]:
            raise InvalidMove("nim.not_that_many", left=self.piles[pile])

        self.piles[pile] -= count
        self.took = seat

    def _result(self) -> Result | None:
        if any(self.piles):
            return None
        # Whoever emptied the table took the last match, and wins.
        return Result(winner_seat=self.took)

    def public_state(self) -> dict:
        return {"piles": self.piles}
