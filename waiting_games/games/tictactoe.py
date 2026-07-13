"""Tic tac toe: two players, a 3x3 board, X moves first."""

from __future__ import annotations

from .base import Game, InvalidMove

# fmt: off
LINES = (
    (0, 1, 2), (3, 4, 5), (6, 7, 8),  # rows
    (0, 3, 6), (1, 4, 7), (2, 5, 8),  # columns
    (0, 4, 8), (2, 4, 6),             # diagonals
)
# fmt: on

MARKS = ("X", "O")


class TicTacToe(Game):
    key = "tictactoe"
    title = "Tic Tac Toe"
    min_players = 2
    max_players = 2

    def __init__(self) -> None:
        super().__init__()
        self.board: list[str | None] = [None] * 9

    def _apply(self, seat: int, move: dict) -> None:
        cell = move.get("cell")
        # bool is a subclass of int, and board[True] is a legal index into cell 1.
        if isinstance(cell, bool) or not isinstance(cell, int) or not 0 <= cell <= 8:
            raise InvalidMove("cell must be 0-8")
        if self.board[cell] is not None:
            raise InvalidMove("that cell is taken")
        self.board[cell] = MARKS[seat]

    def _winner_index(self) -> int | None:
        for a, b, c in LINES:
            if (
                self.board[a] is not None
                and self.board[a] == self.board[b] == self.board[c]
            ):
                return MARKS.index(self.board[a])
        return None

    def _is_draw(self) -> bool:
        return all(cell is not None for cell in self.board)

    def public_state(self) -> dict:
        return {
            "board": self.board,
            "marks": {player: MARKS[seat] for seat, player in enumerate(self.players)},
        }
