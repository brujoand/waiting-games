"""Snake: steer your snake, eat the apples, don't crash. Last snake alive wins.

The first real-time game. There are no turns: every player may steer on every
tick, and a move is INTENT ("I am now heading left") that tick() acts on -- it
does not move the snake by itself. That is what stops a held arrow key from
turning into a message per frame.

Solo is a first-class mode (min_players = 1): survive as long as you can, and
your length is the score.
"""

from __future__ import annotations

import random

from .base import InvalidMove, RealTimeGame, Result

WIDTH = HEIGHT = 24
START_LENGTH = 3
APPLES = 3
GROWTH = 2  # cells gained per apple

DIRECTIONS = {
    "up": (0, -1),
    "down": (0, 1),
    "left": (-1, 0),
    "right": (1, 0),
}


class SnakeBody:
    def __init__(self, cells: list[tuple[int, int]], heading: str) -> None:
        self.cells = cells  # head first
        self.heading = heading
        self.pending = heading  # the direction asked for, applied on the next tick
        self.growing = 0
        self.alive = True

    @property
    def head(self) -> tuple[int, int]:
        return self.cells[0]


class Snake(RealTimeGame):
    key = "snake"
    title = "Snake"
    min_players = 1
    max_players = 6
    tick_hz = 8.0  # the snake moves one cell per tick, so this IS the speed

    def __init__(self) -> None:
        super().__init__()
        self.snakes: list[SnakeBody] = []
        self.apples: list[tuple[int, int]] = []
        self.rng = random.Random()
        self.elapsed = 0.0

    def _on_start(self) -> None:
        """Space the snakes evenly down the board, all facing right."""
        self.snakes = []
        for seat in range(len(self.players)):
            row = (seat + 1) * HEIGHT // (len(self.players) + 1)
            cells = [(START_LENGTH - i, row) for i in range(START_LENGTH)]
            self.snakes.append(SnakeBody(cells, "right"))

        self.apples = []
        for _ in range(APPLES):
            self._grow_an_apple()

    # -- the world -------------------------------------------------------

    def _occupied(self) -> set[tuple[int, int]]:
        taken = {cell for snake in self.snakes if snake.alive for cell in snake.cells}
        taken.update(self.apples)
        return taken

    def _grow_an_apple(self) -> None:
        free = [
            (x, y)
            for x in range(WIDTH)
            for y in range(HEIGHT)
            if (x, y) not in self._occupied()
        ]
        if free:
            self.apples.append(self.rng.choice(free))

    # -- input is intent, not action --------------------------------------

    def _apply(self, seat: int, move: dict) -> None:
        heading = move.get("dir")
        if heading not in DIRECTIONS:
            raise InvalidMove("snake.unknown_direction")

        snake = self.snakes[seat]
        if not snake.alive:
            raise InvalidMove("snake.dead")

        # No reversing into your own neck. Compare against the direction actually
        # travelled, not the pending one -- otherwise two quick turns in one tick
        # (right, then up, then left) would fold the snake back on itself.
        dx, dy = DIRECTIONS[heading]
        cx, cy = DIRECTIONS[snake.heading]
        if len(snake.cells) > 1 and (dx, dy) == (-cx, -cy):
            raise InvalidMove("snake.no_reverse")

        snake.pending = heading  # tick() is what actually turns the snake

    # -- the clock --------------------------------------------------------

    def tick(self, dt: float) -> None:
        self.elapsed += dt

        living = [s for s in self.snakes if s.alive]
        if not living:
            return

        # Everyone moves at once, so work out every new head BEFORE resolving any
        # collision. Doing it snake-by-snake would let whoever is first in the
        # list win a head-on that should kill them both.
        heads: dict[SnakeBody, tuple[int, int]] = {}
        for snake in living:
            snake.heading = snake.pending
            dx, dy = DIRECTIONS[snake.heading]
            x, y = snake.head
            heads[snake] = (x + dx, y + dy)

        # A tail cell moves out of the way this tick, so following one is legal --
        # unless its owner is growing, in which case the tail stays put.
        bodies: set[tuple[int, int]] = set()
        for snake in living:
            keep = snake.cells if snake.growing else snake.cells[:-1]
            bodies.update(keep)

        doomed: set[SnakeBody] = set()
        for snake, head in heads.items():
            x, y = head
            if not (0 <= x < WIDTH and 0 <= y < HEIGHT):
                doomed.add(snake)  # into the wall
            elif head in bodies:
                doomed.add(snake)  # into somebody, possibly themselves
            else:
                # Two heads into the same cell: both of them.
                rivals = [s for s, h in heads.items() if s is not snake and h == head]
                if rivals:
                    doomed.add(snake)
                    doomed.update(rivals)

        for snake in living:
            if snake in doomed:
                snake.alive = False
                continue

            head = heads[snake]
            snake.cells.insert(0, head)

            if head in self.apples:
                self.apples.remove(head)
                snake.growing += GROWTH
                self._grow_an_apple()

            if snake.growing:
                snake.growing -= 1  # keep the tail: the snake gets longer
            else:
                snake.cells.pop()

        self._settle()

    def _settle(self) -> None:
        alive = [seat for seat, snake in enumerate(self.snakes) if snake.alive]
        solo = len(self.players) == 1

        if solo:
            if not alive:
                self.finish(Result.draw())  # nobody to beat; the score is the length
            return

        if len(alive) == 1:
            self.finish(Result(winner_seat=alive[0]))
        elif not alive:
            self.finish(Result.draw())  # everybody crashed on the same tick

    # -- what everyone sees -----------------------------------------------

    def public_state(self) -> dict:
        return {
            "width": WIDTH,
            "height": HEIGHT,
            "apples": [list(apple) for apple in self.apples],
            "seconds": round(self.elapsed, 1),
            # The client slides the snake between cells rather than teleporting it,
            # and this is how long it has to do the sliding in. Sent rather than
            # hardcoded over there: the tick rate IS the snake's speed, so a magic
            # 125 in the renderer would be a second copy of the game's difficulty,
            # silently wrong the day anyone tunes it.
            "tickHz": self.tick_hz,
            "snakes": [
                {
                    "player": self.players[seat],
                    "cells": [list(cell) for cell in snake.cells],
                    "alive": snake.alive,
                    "length": len(snake.cells),
                }
                for seat, snake in enumerate(self.snakes)
            ],
        }
