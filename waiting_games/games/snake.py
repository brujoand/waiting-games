"""Snake: steer your snake, eat the apples, don't crash. Last snake alive wins.

The first real-time game. There are no turns: every player may steer on every
tick, and a move is INTENT ("I am now heading left") that the clock acts on -- it
does not move the snake by itself. That is what stops a held arrow key from
turning into a message per frame.

Solo is a first-class mode (min_players = 1): survive as long as you can, and
your length is the score.

-- why a move is DECIDED a tick before it HAPPENS ---------------------------

A tick used to read the intent standing at the instant it fired, and move. That
is the obvious design and it makes the game unsteerable, for a reason that has
nothing to do with the rules and everything to do with the fact that a snake is
drawn moving and the server moves it in jumps.

The browser has to slide the snake between cells or it lurches a whole square six
times a second. It can only slide between two cells it knows -- so it has to wait
for the far one, which means drawing the snake a cell behind where the server has
already put it. That cell is the lag: you steer the snake you can SEE, and it is
not the one the server has. Slowing the game down cannot help, because the delay
is one tick and a tick IS one cell, at every possible tick rate.

So decide each move one tick early and say so. `step` is what a snake WILL do on
the next tick -- the cell it takes, or nothing if that move kills it -- fixed at
the end of the tick before, and sent out with the state. The browser is then
animating a move that has already been decided rather than guessing at one, so it
can draw it AS IT HAPPENS, in real time, with no cell of delay and nothing to
snap back from when the guess was wrong.

What it costs is that your key lands on the move after the one already in flight.
That is not new latency -- it is the same tick you always waited, moved to where
it can be seen -- and it nets out FASTER, because the screen stops being a cell
behind. Half a tick to see your own turn, where it used to be a tick and a half.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

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


@dataclass
class Step:
    """What a snake does on the NEXT tick. Decided at the end of this one.

    This is the whole contract with the renderer: it is a fact about a tick that
    has not happened yet, which is what lets the browser draw the move while it is
    happening instead of a cell after it did.
    """

    heading: str
    to: tuple[int, int] | None  # the cell the head takes; None if the move kills it
    grows: bool  # ...and whether the tail stays put, because it ate

    @property
    def fatal(self) -> bool:
        return self.to is None


class SnakeBody:
    def __init__(self, cells: list[tuple[int, int]], heading: str) -> None:
        self.cells = cells  # head first
        self.heading = heading  # the direction of the move it last made
        self.pending = heading  # ...and the one the player has asked for since
        self.growing = 0
        self.alive = True
        self.step: Step | None = None  # what it does next: set by _decide()

    @property
    def head(self) -> tuple[int, int]:
        return self.cells[0]

    @property
    def facing(self) -> str:
        """The direction it will be travelling once its next move is made.

        Not the one it last travelled. By the time a fresh intent can be acted on,
        the move already in flight has happened -- so this is the direction the
        neck will be in, and the direction a reversal has to be judged against.
        """
        return self.step.heading if self.step else self.heading


class Snake(RealTimeGame):
    key = "snake"
    title = "Snake"
    min_players = 1
    max_players = 6
    # The snake moves one cell per tick, so this IS the speed -- there is no
    # separate difficulty knob, and there must not be one. It was 8 Hz, which
    # players found too fast to steer: a 24-cell board crossed in three seconds
    # leaves about a sixth of a second to see a wall coming and do something
    # about it. 6 Hz gives you a third.
    #
    # It is on the wire (public_state), and the renderer slides the snake across
    # exactly this interval, so tuning it here is the whole change.
    tick_hz = 6.0

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

        # The first tick executes a move like every other one, so there has to be
        # a move for it to execute.
        self._decide()

    # -- the world -------------------------------------------------------

    def _occupied(self) -> set[tuple[int, int]]:
        taken = {cell for snake in self.snakes if snake.alive for cell in snake.cells}
        taken.update(self.apples)
        return taken

    def _grow_an_apple(self) -> None:
        # _occupied() is built ONCE. It used to be called from inside the filter,
        # which rebuilt the whole occupied set for every one of the board's 576
        # cells -- and the set is every cell of every snake, so the cost climbed
        # with the snake: 0.3ms when it was three cells long, 4ms at eighty.
        #
        # That lands on the tick that eats the apple, inside the tick loop, and it
        # pushed that one tick ~12ms late. The browser slides the snake between
        # ticks and measures how long it has to slide for, so a late tick made it
        # stall and then jump -- once every few seconds, which is how often you eat.
        # Smooth animation is a bargain the server has to keep too.
        taken = self._occupied()
        free = [
            (x, y) for x in range(WIDTH) for y in range(HEIGHT) if (x, y) not in taken
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

        # No reversing into your own neck. Judged against the direction the snake
        # will be FACING once the move already in flight has been made -- see
        # SnakeBody.facing -- because that is the move this intent follows. It used
        # to be judged against the direction last travelled, which was the same
        # thing back when a tick read the intent standing at the moment it fired.
        dx, dy = DIRECTIONS[heading]
        cx, cy = DIRECTIONS[snake.facing]
        if len(snake.cells) > 1 and (dx, dy) == (-cx, -cy):
            raise InvalidMove("snake.no_reverse")

        snake.pending = heading  # _decide() is what actually turns the snake

    # -- the clock --------------------------------------------------------

    def tick(self, dt: float) -> None:
        self.elapsed += dt

        if not any(snake.alive for snake in self.snakes):
            return

        self._execute()  # ...the move decided last tick, which is on every screen
        self._settle()
        self._decide()  # ...and the next one, from the intent standing right now

    def _execute(self) -> None:
        """Carry out the move every client has already been told about."""
        for snake in self.snakes:
            if not snake.alive or snake.step is None:
                continue

            if snake.step.fatal:
                snake.alive = False
                continue

            head = snake.step.to
            snake.heading = snake.step.heading
            snake.cells.insert(0, head)

            if head in self.apples:
                self.apples.remove(head)
                snake.growing += GROWTH
                self._grow_an_apple()

            if snake.growing:
                snake.growing -= 1  # keep the tail: the snake gets longer
            else:
                snake.cells.pop()

    def _decide(self) -> None:
        """Fix what happens on the NEXT tick, and hand it to the renderer.

        Everything the old tick() worked out at the moment of moving is worked out
        here instead, one tick earlier. It is the same arithmetic on the same
        board -- the only thing that has moved is WHEN, and the point of moving it
        is that the answer can now be put on the wire before it is needed.
        """
        living = [snake for snake in self.snakes if snake.alive]

        # Everyone moves at once, so work out every new head BEFORE resolving any
        # collision. Doing it snake-by-snake would let whoever is first in the
        # list win a head-on that should kill them both.
        heads: dict[SnakeBody, tuple[int, int]] = {}
        for snake in living:
            dx, dy = DIRECTIONS[snake.pending]
            x, y = snake.head
            heads[snake] = (x + dx, y + dy)

        # A tail cell moves out of the way next tick, so following one is legal --
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
            head = heads[snake]
            snake.step = Step(
                heading=snake.pending,
                to=None if snake in doomed else head,
                # The tail holds if the snake is still growing from the last apple,
                # or is about to eat the next one. Without this the browser slides
                # the tail forward on a snake that is getting longer, and the state
                # puts it back a sixth of a second later -- a tail that flickers
                # once per apple, every apple.
                grows=snake.growing > 0 or head in self.apples,
            )

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
            # `seconds` is the SCORE, not a clock to animate against: it is rounded
            # to a tenth, and at these rates a tenth cannot tell one tick from two. The
            # renderer uses the platform's `tick` and `tickHz` for that.
            "seconds": round(self.elapsed, 1),
            "snakes": [
                {
                    "player": self.players[seat],
                    "cells": [list(cell) for cell in snake.cells],
                    "alive": snake.alive,
                    "length": len(snake.cells),
                    # What it does NEXT tick, so the browser can draw the move
                    # while it happens instead of a cell after it did. `next` is
                    # the cell the head takes -- null if that move kills it, and
                    # then the snake simply stops, which is what the engine does
                    # too: it dies where it stands rather than in the wall.
                    #
                    # This is not hidden information. Snake has none: every cell of
                    # every snake is already on the wire, and a move that is fixed
                    # is a fact about the board, not a peek at somebody's keyboard.
                    "next": (
                        list(snake.step.to)
                        if snake.alive and snake.step and snake.step.to
                        else None
                    ),
                    "grows": bool(snake.alive and snake.step and snake.step.grows),
                }
                for seat, snake in enumerate(self.snakes)
            ],
        }
