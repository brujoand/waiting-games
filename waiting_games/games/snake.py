"""Snake, off the grid.

The head is at (11.37, 4.02). Not cell (11, 4) -- there are no cells. It travels
along a real line at a real speed, it turns the moment you ask it to rather than at
the next square, and it eats an apple by running into it rather than by landing
exactly on it.

-- why, and it is not cosmetic ---------------------------------------------

A grid game cannot be played over a network, and it took a week to find out.

On a grid, the SMALLEST error the wire can hand you is one whole cell -- there is
nothing between cell 5 and cell 6 -- and one cell is precisely the granularity that
decides whether you are alive. A packet 300ms late did not make the game a little
bit wrong. It made you dead. Every attempt to fix that (interpolate, buffer,
predict, decide the move a tick early, bound the delay, catch up gently) was an
attempt to hide a quantum the same size as the game, and none of them could.

Off the grid, that same 300ms puts you a fifth of a unit out of place. A fifth of a
unit is a smudge nobody can see, and it changes the TIMING of a collision by a few
milliseconds instead of flipping whether it happened at all.

That is the property the .io games have and we did not. Not smoothness -- forgiveness.

-- floats are fine. sin, cos and sqrt are not. -----------------------------

Every number here moves through + - * / only, on IEEE-754 doubles, which Python and
JavaScript specify identically to the last bit. Distances are compared SQUARED so
that no square root is ever taken. There is no angle anywhere, which is exactly why
the snake turns in four directions rather than through a full circle.

That is not taste, it is the price of the safety net. The browser plays a solo game
itself and the server replays it afterwards to check the score (see client_clock),
and a rollback for multiplayer would need the same guarantee. Both rest on the two
simulations agreeing EXACTLY -- and one transcendental function, which its standard
permits to differ in the last bit, would be two different games.

The twin of this file is static/games/snake_rules.js. tests/test_determinism.py runs
the same seed and the same moves through both and demands the same board, down to
the last bit of the last float.
"""

from __future__ import annotations

import contextlib
import secrets
from dataclasses import dataclass

from ._rng import Rng
from .base import InvalidMove, RealTimeGame, Result

# 24 units square. It was 24 CELLS square, and a unit is what a cell was, so the
# board is the same size and the snake the same speed as the game people were
# playing. It simply is not made of squares any more.
BOARD = 24.0

# Units per second. This used to BE the tick rate -- the snake moved one cell per
# tick, so speed and clock were the same number and neither could be tuned without
# the other. They are separate now, which is the whole point of what follows.
SPEED = 6.0

# ...so the clock is free, and a shared game wants it fast. At 20 Hz a packet carries
# 50ms of world and 0.3 units of movement. At 6 Hz it carried 167ms and a WHOLE CELL.
# Smaller packets, smaller errors -- and no error that can kill you on its own.
TICK_HZ = 20.0

START_LENGTH = 3.0  # units of body
GROWTH = 2.0  # ...gained per apple
APPLES = 3

HEAD_R = 0.45
BODY_R = 0.40
APPLE_R = 0.40

# How much of your own body, measured back from the head, cannot kill you.
#
# On a grid the neck was one cell and the rule was "no reversing". Off the grid you
# may turn whenever you like, so a quick left-then-left brings the head alongside its
# own neck within a fraction of a unit. Without this the game would kill you for
# turning twice in a hurry, which is not a rule anyone would call fair.
NECK = 1.6

# How far the snake must travel between one turn and the next.
#
# The grid gave us this for free and off the grid we have to say it out loud. You can
# now turn wherever you like -- so turn down, and a fifth of a unit later turn left,
# and the snake is running PARALLEL TO ITS OWN BODY a fifth of a unit away, when the
# body is four fifths of a unit wide. It is inside itself. No neck length fixes that;
# it is geometry.
#
# Every game with a body and a free heading has this problem and they all answer it the
# same way: a minimum turning radius. slither.io caps how fast you can swing round.
# Ours is four directions, so the cap is a distance -- one body-width and a bit, which
# is exactly the separation two parallel runs need in order not to touch.
#
# And it is SOFT. Ask too early and the turn is remembered, not refused, and taken the
# moment it becomes legal. So an early press still works and a late one just turns you
# a little further along -- which is the whole point of leaving the grid. The
# discipline is back; the fatal quantum is not.
MIN_TURN = 1.0

DIRECTIONS = {
    "up": (0.0, -1.0),
    "down": (0.0, 1.0),
    "left": (-1.0, 0.0),
    "right": (1.0, 0.0),
}


def _reach2(a: float, b: float) -> float:
    """(a + b) squared. Everything here compares squared distances."""
    return (a + b) * (a + b)


def _distance2_to_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    """How far a point is from a segment, SQUARED.

    Squared, always. A square root is allowed by its own standard to differ in the
    last bit between implementations, and one differing bit is two different games.
    """
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay

    span = vx * vx + vy * vy
    if span == 0.0:  # a corner: the segment is a single point
        return wx * wx + wy * wy

    along = (wx * vx + wy * vy) / span
    if along < 0.0:
        along = 0.0
    elif along > 1.0:
        along = 1.0

    dx = px - (ax + vx * along)
    dy = py - (ay + vy * along)
    return dx * dx + dy * dy


@dataclass
class SnakeBody:
    """A snake is a PATH, not a list of cells.

    `path` is the polyline it occupies, head first. A vertex appears only where it
    TURNS -- between corners it is a straight run and the head just slides along it --
    so a snake that has gone straight for a minute is two points, not four hundred.
    """

    path: list[list[float]]
    heading: str
    pending: str = ""
    length: float = START_LENGTH
    growing: float = 0.0
    alive: bool = True
    # Distance travelled since the last corner. A snake may not turn inside its own
    # width -- see MIN_TURN -- so a turn asked for too early WAITS rather than being
    # thrown away.
    straight: float = MIN_TURN

    def __post_init__(self) -> None:
        self.pending = self.pending or self.heading

    @property
    def head(self) -> list[float]:
        return self.path[0]


class Snake(RealTimeGame):
    key = "snake"
    title = "Snake"
    min_players = 1
    max_players = 6
    tick_hz = TICK_HZ

    def __init__(self, seed: int | None = None) -> None:
        super().__init__()
        self.snakes: list[SnakeBody] = []
        self.apples: list[list[float]] = []
        self.elapsed = 0.0

        self.seed = secrets.randbelow(2**32) if seed is None else seed & 0xFFFFFFFF
        self.rng = Rng(self.seed)

    @property
    def client_clock(self) -> bool:
        """Solo is played in the browser and checked here. See base.RealTimeGame."""
        return len(self.players) == 1

    # -- the world -------------------------------------------------------

    def _on_start(self) -> None:
        """Space the snakes evenly down the board, all facing right."""
        self.rng = Rng(self.seed)  # a replay must begin where the run did
        self.snakes = []

        seats = len(self.players)
        for seat in range(seats):
            row = BOARD * (seat + 1) / (seats + 1)
            self.snakes.append(
                SnakeBody(path=[[START_LENGTH + 1.0, row], [1.0, row]], heading="right")
            )

        self.apples = []
        for _ in range(APPLES):
            self._grow_an_apple()

    def _clear(self, x: float, y: float, clearance: float) -> bool:
        for apple in self.apples:
            dx, dy = x - apple[0], y - apple[1]
            if dx * dx + dy * dy < _reach2(clearance, APPLE_R):
                return False

        for snake in self.snakes:
            if not snake.alive:
                continue
            for i in range(len(snake.path) - 1):
                a, b = snake.path[i], snake.path[i + 1]
                if _distance2_to_segment(x, y, a[0], a[1], b[0], b[1]) < _reach2(
                    clearance, BODY_R
                ):
                    return False
        return True

    def _grow_an_apple(self) -> None:
        """Somewhere free, by rejection, in a BOUNDED number of tries.

        The browser runs this too and must take exactly as many tries as we do, off
        exactly the same generator -- so the loop is bounded and depends on nothing
        but the state both sides already share.
        """
        margin = APPLE_R + 0.2
        span = BOARD - margin - margin

        for _ in range(64):
            x = margin + self.rng.unit() * span
            y = margin + self.rng.unit() * span
            if self._clear(x, y, APPLE_R):
                self.apples.append([x, y])
                return

        # Sixty-four tries and no room: the board is packed. Go without rather than
        # spin -- a snake with nothing left to eat has already won.

    # -- input is intent, not action --------------------------------------

    def _apply(self, seat: int, move: dict) -> None:
        heading = move.get("dir")
        if heading not in DIRECTIONS:
            raise InvalidMove("snake.unknown_direction")

        snake = self.snakes[seat]
        if not snake.alive:
            raise InvalidMove("snake.dead")

        # No turning back on yourself, judged against the direction actually being
        # travelled. There is no "move in flight" to judge it against any more: that
        # whole apparatus -- Step, `next`, deciding a tick early -- existed to paper
        # over the grid, and the grid is gone. A turn takes effect when you ask.
        dx, dy = DIRECTIONS[heading]
        cx, cy = DIRECTIONS[snake.heading]
        if dx == -cx and dy == -cy:
            raise InvalidMove("snake.no_reverse")

        snake.pending = heading

    # -- the clock --------------------------------------------------------

    def tick(self, dt: float) -> None:
        self.elapsed += dt

        living = [s for s in self.snakes if s.alive]
        if not living:
            return

        step = SPEED * dt
        for snake in living:
            self._advance(snake, step)

        # Everybody moves before anybody dies, so two heads meeting kill each other
        # rather than whoever happens to be first in the list.
        for snake in [s for s in living if self._crashed(s)]:
            snake.alive = False

        for snake in living:
            if snake.alive:
                self._eat(snake)

        self._settle()

    def _advance(self, snake: SnakeBody, step: float) -> None:
        if snake.pending != snake.heading and snake.straight >= MIN_TURN:
            # A corner: the head stops being a moving point and becomes a fixed one,
            # and a fresh head sets off from it.
            snake.path.insert(0, [snake.head[0], snake.head[1]])
            snake.heading = snake.pending
            snake.straight = 0.0

        snake.straight += step

        dx, dy = DIRECTIONS[snake.heading]
        snake.path[0][0] += dx * step
        snake.path[0][1] += dy * step

        if snake.growing > 0.0:
            grown = step if step < snake.growing else snake.growing
            snake.length += grown
            snake.growing -= grown

        self._trim(snake)

    def _trim(self, snake: SnakeBody) -> None:
        """Cut the tail back so the path is exactly `length` units long."""
        left = snake.length
        kept: list[list[float]] = []

        for i in range(len(snake.path) - 1):
            a, b = snake.path[i], snake.path[i + 1]
            # Axis-aligned, so a segment's length is |dx| + |dy| exactly. No sqrt.
            span = abs(b[0] - a[0]) + abs(b[1] - a[1])
            kept.append(a)

            if span >= left:
                if span == 0.0:
                    kept.append([a[0], a[1]])
                else:
                    part = left / span
                    kept.append(
                        [a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part]
                    )
                snake.path = kept
                return

            left -= span

        kept.append(snake.path[-1])
        snake.path = kept

    def _crashed(self, snake: SnakeBody) -> bool:
        x, y = snake.head

        if x < HEAD_R or x > BOARD - HEAD_R or y < HEAD_R or y > BOARD - HEAD_R:
            return True

        for other in self.snakes:
            if not other.alive:
                continue
            # Your own neck cannot kill you. Everybody else's body can, right up to
            # their head.
            skip = NECK if other is snake else 0.0
            if self._touches(x, y, other, skip):
                return True

        return False

    def _touches(self, x: float, y: float, other: SnakeBody, skip: float) -> bool:
        walked = 0.0

        for i in range(len(other.path) - 1):
            a, b = other.path[i], other.path[i + 1]
            span = abs(b[0] - a[0]) + abs(b[1] - a[1])

            if walked + span <= skip:
                walked += span
                continue

            ax, ay = a[0], a[1]
            if walked < skip and span > 0.0:
                # The neck ends part-way along this segment. Start from there.
                part = (skip - walked) / span
                ax = a[0] + (b[0] - a[0]) * part
                ay = a[1] + (b[1] - a[1]) * part

            if _distance2_to_segment(x, y, ax, ay, b[0], b[1]) < _reach2(
                HEAD_R, BODY_R
            ):
                return True

            walked += span

        return False

    def _eat(self, snake: SnakeBody) -> None:
        x, y = snake.head

        for apple in list(self.apples):
            dx, dy = x - apple[0], y - apple[1]
            # Overlap is enough. You do not have to land ON it -- there is nowhere to
            # land -- you have to run into it, which is what eating looks like
            # everywhere except on a grid.
            if dx * dx + dy * dy < _reach2(HEAD_R, APPLE_R):
                self.apples.remove(apple)
                snake.growing += GROWTH
                self._grow_an_apple()

    def _settle(self) -> None:
        alive = [seat for seat, snake in enumerate(self.snakes) if snake.alive]
        solo = len(self.players) == 1

        if solo:
            if not alive:
                self.finish(Result.draw())  # nobody to beat; the length is the score
            return

        if len(alive) == 1:
            self.finish(Result(winner_seat=alive[0]))
        elif not alive:
            self.finish(Result.draw())  # everybody crashed on the same tick

    def run(self, moves: list[dict], ticks: int) -> None:
        """Play the run the browser says it played, and see what really happened."""
        at_tick: dict[int, list[dict]] = {}
        for move in moves:
            at_tick.setdefault(int(move["tick"]), []).append(move)

        for tick in range(ticks):
            for move in at_tick.get(tick, []):
                with contextlib.suppress(InvalidMove):
                    self.apply_move(self.players[0], {"dir": move["dir"]})
            if self.over:
                return
            self.tick(1 / self.tick_hz)

    # -- what everyone sees -----------------------------------------------

    def public_state(self) -> dict:
        return {
            "board": BOARD,
            "headR": HEAD_R,
            "bodyR": BODY_R,
            "appleR": APPLE_R,
            "speed": SPEED,
            # The browser plays a solo game itself, and cannot grow the same apples
            # without this. It is not a secret: it IS the game.
            "seed": self.seed,
            "apples": [[a[0], a[1]] for a in self.apples],
            # RAW, not rounded. Python rounds a half to even and JavaScript rounds it
            # up, so a rounded float on the wire is a divergence waiting for the right
            # value to come along. Formatting is the renderer's job.
            "seconds": self.elapsed,
            "snakes": [
                {
                    "player": self.players[seat],
                    # The path it occupies, head first. Not cells: there are none.
                    "path": [[p[0], p[1]] for p in snake.path],
                    "heading": snake.heading,
                    "alive": snake.alive,
                    # The score, and a real number now: you are as long as you are.
                    "length": snake.length,
                }
                for seat, snake in enumerate(self.snakes)
            ],
        }


def replay(seed: int, players: list[str], moves: list[dict], ticks: int) -> Snake:
    """Run a game again from its seed and its moves, and see what really happened."""
    game = Snake(seed=seed)
    for player in players:
        game.add_player(player)
    game.start()
    game.run(moves, ticks)
    return game
