"""Connect Four: 7x6 board, drop a piece down a column, four in a row wins."""

from __future__ import annotations

from .base import Game, InvalidMove, Result

COLS, ROWS = 7, 6
MARKS = ("R", "G")

# Right, down, and the two diagonals. The other four directions are these run
# backwards, and every line gets found from its own top-left end anyway.
DIRECTIONS = ((0, 1), (1, 0), (1, 1), (1, -1))


class ConnectFour(Game):
    key = "connectfour"
    title = "Connect Four"
    min_players = 2
    max_players = 2

    def __init__(self) -> None:
        super().__init__()
        self.board: list[str | None] = [None] * (COLS * ROWS)  # row 0 is the top
        self.last: int | None = None  # the cell just played, for highlighting

    def _landing_row(self, col: int) -> int | None:
        """The lowest empty row in a column, or None when it is full."""
        for row in reversed(range(ROWS)):
            if self.board[row * COLS + col] is None:
                return row
        return None

    def _apply(self, seat: int, move: dict) -> None:
        col = move.get("column")
        # bool is a subclass of int, and board[True] is a legal index.
        if isinstance(col, bool) or not isinstance(col, int) or not 0 <= col < COLS:
            raise InvalidMove(f"the column must be 0-{COLS - 1}")

        row = self._landing_row(col)
        if row is None:
            raise InvalidMove("the column is full")

        self.last = row * COLS + col
        self.board[self.last] = MARKS[seat]

    def _four_in_a_row(self) -> int | None:
        for row in range(ROWS):
            for col in range(COLS):
                mark = self.board[row * COLS + col]
                if mark is None:
                    continue
                for dr, dc in DIRECTIONS:
                    cells = [(row + dr * i, col + dc * i) for i in range(4)]
                    if all(
                        0 <= r < ROWS
                        and 0 <= c < COLS
                        and self.board[r * COLS + c] == mark
                        for r, c in cells
                    ):
                        return MARKS.index(mark)
        return None

    def _result(self) -> Result | None:
        seat = self._four_in_a_row()
        if seat is not None:
            return Result(winner_seat=seat)
        # The top row filling up means every column is full.
        if all(self.board[col] is not None for col in range(COLS)):
            return Result.draw()
        return None

    def public_state(self) -> dict:
        return {
            "board": self.board,
            "cols": COLS,
            "rows": ROWS,
            "last": self.last,
            "marks": {player: MARKS[seat] for seat, player in enumerate(self.players)},
        }
