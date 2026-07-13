"""Dots and Boxes: draw a line between two dots. Close a box and you go again.

The rule that needs the platform: closing a box means you go AGAIN. That is the
same _next_seat hook Othello uses to SKIP a player -- it just returns the current
seat instead of a different one.

Edges are indexed as two grids: `h[row][col]` is the horizontal edge below dot
(row, col), `v[row][col]` the vertical one to its right. A box (row, col) is
closed when its four surrounding edges are all drawn.
"""

from __future__ import annotations

from .base import Game, InvalidMove, Result

BOXES = 4  # a 4x4 grid of boxes, so 5x5 dots
DOTS = BOXES + 1


class DotsAndBoxes(Game):
    key = "dotsandboxes"
    title = "Dots and Boxes"
    min_players = 2
    max_players = 4

    def __init__(self) -> None:
        super().__init__()
        # Horizontal edges: DOTS rows of BOXES. Vertical: BOXES rows of DOTS.
        self.horizontal: list[bool] = [False] * (DOTS * BOXES)
        self.vertical: list[bool] = [False] * (BOXES * DOTS)
        # Which seat owns each closed box; None while it is still open.
        self.boxes: list[int | None] = [None] * (BOXES * BOXES)
        self.claimed_a_box = False

    # -- rules -----------------------------------------------------------

    def _edges(self, kind: str) -> list[bool]:
        return self.horizontal if kind == "h" else self.vertical

    def _box_is_closed(self, row: int, col: int) -> bool:
        return (
            self.horizontal[row * BOXES + col]  # top
            and self.horizontal[(row + 1) * BOXES + col]  # bottom
            and self.vertical[row * DOTS + col]  # left
            and self.vertical[row * DOTS + col + 1]  # right
        )

    def _claim_boxes(self, seat: int) -> int:
        """Award every box that is now closed and unowned. Returns how many."""
        claimed = 0
        for row in range(BOXES):
            for col in range(BOXES):
                index = row * BOXES + col
                if self.boxes[index] is None and self._box_is_closed(row, col):
                    self.boxes[index] = seat
                    claimed += 1
        return claimed

    # -- the platform's hooks ---------------------------------------------

    def _apply(self, seat: int, move: dict) -> None:
        kind, index = move.get("kind"), move.get("index")

        if kind not in ("h", "v"):
            raise InvalidMove("the line must be 'h' or 'v'")
        if isinstance(index, bool) or not isinstance(index, int):
            raise InvalidMove("the line must be a number")

        edges = self._edges(kind)
        if not 0 <= index < len(edges):
            raise InvalidMove("that line does not exist")
        if edges[index]:
            raise InvalidMove("that line is already drawn")

        edges[index] = True
        # Remembered for _next_seat, which runs straight after this.
        self.claimed_a_box = self._claim_boxes(seat) > 0

    def _next_seat(self, seat: int) -> int:
        """Close a box and it stays your turn."""
        if self.claimed_a_box:
            return seat
        return (seat + 1) % len(self.players)

    def _result(self) -> Result | None:
        if any(box is None for box in self.boxes):
            return None  # boxes still up for grabs
        return Result.by_score(self.scores())

    def scores(self) -> list[int]:
        return [self.boxes.count(seat) for seat in range(len(self.players))]

    def public_state(self) -> dict:
        return {
            "horizontal": self.horizontal,
            "vertical": self.vertical,
            "boxes": self.boxes,
            "size": BOXES,
            # Keyed by player, not by seat: the renderer would otherwise have to
            # assume the platform's playerNames dict is ordered by seat, which is
            # true today and would break silently the day it is not.
            "counts": {
                player: self.boxes.count(seat)
                for seat, player in enumerate(self.players)
            },
        }
