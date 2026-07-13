"""Othello: place a disc that flanks at least one of the opponent's. Most discs wins.

The one rule that needs the platform: a player with no legal move is SKIPPED, and
when neither player can move the game ends on the disc count. Both fall out of
_next_seat and _result -- the base class needs nothing.
"""

from __future__ import annotations

from .base import Game, InvalidMove, Result

SIZE = 8
MARKS = ("S", "H")  # black, white -- black goes first

DIRECTIONS = (
    (-1, -1),
    (-1, 0),
    (-1, 1),
    (0, -1),
    (0, 1),
    (1, -1),
    (1, 0),
    (1, 1),
)


class Othello(Game):
    key = "othello"
    title = "Othello"
    min_players = 2
    max_players = 2

    def __init__(self) -> None:
        super().__init__()
        self.board: list[str | None] = [None] * (SIZE * SIZE)
        # The standard opening: a crossed square in the middle.
        self.board[3 * SIZE + 3] = MARKS[1]
        self.board[3 * SIZE + 4] = MARKS[0]
        self.board[4 * SIZE + 3] = MARKS[0]
        self.board[4 * SIZE + 4] = MARKS[1]

    # -- rules -----------------------------------------------------------

    def _flips(self, seat: int, cell: int) -> list[int]:
        """Every disc this move would turn over. Empty means the move is illegal."""
        if self.board[cell] is not None:
            return []

        mine, theirs = MARKS[seat], MARKS[1 - seat]
        row, col = divmod(cell, SIZE)
        flipped: list[int] = []

        for dr, dc in DIRECTIONS:
            run: list[int] = []
            r, c = row + dr, col + dc
            # Walk over an unbroken line of the opponent's discs...
            while (
                0 <= r < SIZE and 0 <= c < SIZE and self.board[r * SIZE + c] == theirs
            ):
                run.append(r * SIZE + c)
                r, c = r + dr, c + dc
            # ...and keep it only if one of mine closes the far end.
            if (
                run
                and 0 <= r < SIZE
                and 0 <= c < SIZE
                and self.board[r * SIZE + c] == mine
            ):
                flipped.extend(run)

        return flipped

    def _legal_cells(self, seat: int) -> list[int]:
        return [cell for cell in range(SIZE * SIZE) if self._flips(seat, cell)]

    # -- the platform's hooks ---------------------------------------------

    def _apply(self, seat: int, move: dict) -> None:
        cell = move.get("cell")
        if (
            isinstance(cell, bool)
            or not isinstance(cell, int)
            or not 0 <= cell < SIZE * SIZE
        ):
            raise InvalidMove(f"the cell must be 0-{SIZE * SIZE - 1}")

        flipped = self._flips(seat, cell)
        if not flipped:
            raise InvalidMove("that move does not flank any discs")

        self.board[cell] = MARKS[seat]
        for flip in flipped:
            self.board[flip] = MARKS[seat]

    def _next_seat(self, seat: int) -> int:
        """Skip a player who cannot move. _result has already ruled out the case
        where NEITHER can, so there is always someone to hand the turn to."""
        other = 1 - seat
        return other if self._legal_cells(other) else seat

    def _result(self) -> Result | None:
        if self._legal_cells(0) or self._legal_cells(1):
            return None  # somebody can still play
        return Result.by_score(self.scores())

    def scores(self) -> list[int]:
        return [self.board.count(mark) for mark in MARKS]

    def public_state(self) -> dict:
        # Show the player to move where they may play. This is not a secret --
        # anyone can derive it from the board -- so it is fine in the shared view.
        legal = self._legal_cells(self.turn) if self.started and not self.over else []
        counts = self.scores()
        return {
            "board": self.board,
            "size": SIZE,
            "legal": legal,
            # Keyed by player rather than seat, so the renderer never has to
            # assume the platform's playerNames dict is ordered by seat.
            "counts": {
                player: counts[seat] for seat, player in enumerate(self.players)
            },
            "marks": {player: MARKS[seat] for seat, player in enumerate(self.players)},
        }
