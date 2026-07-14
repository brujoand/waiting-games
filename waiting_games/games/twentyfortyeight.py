"""2048: slide the tiles, and every pair that meets doubles. Reach 2048 and win.

The first game with exactly one seat, which is why the lobby now starts a game
the moment it is full -- a solo game is full the instant it is created, and there
has never been anything to wait for.

The key is not "2048". A game's key is the prefix of its error codes, and a code
must start with a letter (test_every_error_is_raised_with_a_code_not_a_sentence)
-- so the key spells the title out. The player never sees it either way.
"""

from __future__ import annotations

import random

from .base import Game, InvalidMove, Result

SIZE = 4
TARGET = 2048

# The tile that arrives after a slide is a 2, nine times out of ten.
SPAWN_FOUR = 0.1

DIRECTIONS = ("up", "down", "left", "right")


class TwentyFortyEight(Game):
    key = "twentyfortyeight"
    title = "2048"
    min_players = 1
    max_players = 1

    def __init__(self) -> None:
        super().__init__()
        self.rng = random.Random()
        self.tiles: list[int] = [0] * (SIZE * SIZE)
        self.score = 0
        self.moves = 0
        # The last slide, tile by tile, and the cell the free tile landed in. The
        # board alone cannot tell the browser whether a 4 slid across the row or
        # was born there when two 2s met -- and those are the two things a player
        # most needs to see. So the slide says.
        self.slid: list[dict] = []
        self.spawned: int | None = None

    def _on_start(self) -> None:
        self.tiles = [0] * (SIZE * SIZE)
        self.score = 0
        self.moves = 0
        self.slid = []
        self.spawned = None
        self._spawn()
        self._spawn()

    # -- the board -------------------------------------------------------

    def _spawn(self) -> int | None:
        free = [cell for cell, value in enumerate(self.tiles) if not value]
        if not free:
            return None
        cell = self.rng.choice(free)
        self.tiles[cell] = 4 if self.rng.random() < SPAWN_FOUR else 2
        return cell

    def _lines(self, heading: str) -> list[list[int]]:
        """The board as lines, each read from the wall the tiles slide INTO.

        Every direction is the same problem once the line is the right way round:
        pack towards the front, merge, pack again. Reversing the line here is what
        keeps `up` from being a second implementation of `down`.
        """
        lines = []
        for index in range(SIZE):
            if heading in ("left", "right"):
                line = [index * SIZE + column for column in range(SIZE)]
                lines.append(line if heading == "left" else line[::-1])
            else:
                line = [row * SIZE + index for row in range(SIZE)]
                lines.append(line if heading == "up" else line[::-1])
        return lines

    @staticmethod
    def _pack(values: list[int]) -> tuple[list[int], int, list[tuple[int, int, bool]]]:
        """One line slid to the front: the tiles, the points, and every journey.

        A tile may merge only ONCE per slide: 2 2 4 becomes 4 4, never 8. Hence
        the index skipping past both halves of a merge rather than a loop that
        keeps folding the front of the line into itself.

        The journeys are `(from, to, merged)` in slots along this line, one per
        tile that was ON the line -- including a tile that ends up where it began,
        because "it did not move" is itself something the browser has to draw.
        Both halves of a merge report the same destination: they travel to the same
        square, and one of them stops existing there.
        """
        tiles = [(slot, value) for slot, value in enumerate(values) if value]
        packed: list[int] = []
        gained = 0
        journeys: list[tuple[int, int, bool]] = []
        index = 0

        while index < len(tiles):
            slot, value = tiles[index]
            destination = len(packed)  # the front of the line grows by one either way

            if index + 1 < len(tiles) and tiles[index + 1][1] == value:
                merged = value * 2
                packed.append(merged)
                gained += merged  # the merged tile IS the score, as in the original
                journeys.append((slot, destination, True))
                journeys.append((tiles[index + 1][0], destination, True))
                index += 2
            else:
                packed.append(value)
                journeys.append((slot, destination, False))
                index += 1

        return packed + [0] * (SIZE - len(packed)), gained, journeys

    def _slide(self, heading: str) -> tuple[list[int], int, list[dict]]:
        """The board as it would be after this slide. Does not commit it."""
        tiles = list(self.tiles)
        gained = 0
        slid: list[dict] = []

        for line in self._lines(heading):
            packed, points, journeys = self._pack([self.tiles[cell] for cell in line])
            gained += points

            # A journey is in slots along the line; the browser draws cells. `line`
            # is the map between them, and it already knows which way round it runs.
            for source, destination, merged in journeys:
                slid.append(
                    {
                        "from": line[source],
                        "to": line[destination],
                        "value": self.tiles[line[source]],
                        "merged": merged,
                    }
                )

            for cell, value in zip(line, packed, strict=True):
                tiles[cell] = value

        return tiles, gained, slid

    def _stuck(self) -> bool:
        if 0 in self.tiles:
            return False
        # A full board is only over if nothing can merge -- and a merge is exactly
        # a slide that changes something.
        return all(self._slide(heading)[0] == self.tiles for heading in DIRECTIONS)

    # -- moves -----------------------------------------------------------

    def _apply(self, seat: int, move: dict) -> None:
        heading = move.get("dir")
        if heading not in DIRECTIONS:
            raise InvalidMove("twentyfortyeight.unknown_direction")

        tiles, gained, slid = self._slide(heading)
        if tiles == self.tiles:
            # A slide that moves nothing is not a move. It must not be answered
            # with a free tile -- on a tight board, one tile you did not earn is
            # the difference between a run you can save and one you cannot -- and
            # it must not be answered with an ERROR either.
            #
            # It was, briefly, and playing the game showed why not: pack a board
            # into the top-left corner and both `left` and `up` do nothing for
            # several presses in a row, so a player pressing perfectly reasonable
            # keys got a red toast for each one. The game they know does nothing
            # at all here, and doing nothing is a thing this engine can say: return
            # without touching the board.
            return

        self.tiles = tiles
        self.score += gained
        self.moves += 1
        self.slid = slid
        self.spawned = self._spawn()

    def _result(self) -> Result | None:
        if max(self.tiles) >= TARGET:
            return Result(winner_seat=0)
        if self._stuck():
            # Nowhere left to slide. There is nobody to lose TO, so the platform
            # can only call this a draw -- and the renderer overrides it, because
            # a neutral chime for "you are out of moves" is exactly backwards.
            # Snake's solo run ends the same way, for the same reason.
            return Result.draw()
        return None

    # -- what everyone sees ------------------------------------------------

    def public_state(self) -> dict:
        return {
            "size": SIZE,
            "tiles": list(self.tiles),
            "score": self.score,
            "target": TARGET,
            "moves": self.moves,
            # How the board GOT here, which two boards in a row cannot say. `moves`
            # is what makes it safe to act on: a browser that has drawn move 7 and
            # is handed move 8 knows this slide is the step between the two, and a
            # browser handed anything else -- a reconnect, a spectator arriving
            # mid-run -- knows it is not, and just paints the board it was given.
            "slid": self.slid,
            "spawned": self.spawned,
        }
