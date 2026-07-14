"""Snakes: the same idea as Snake, off the grid and with no edges to hit.

Snake is the Nokia game and stays the Nokia game: a matrix, one cell per tick, and
walls that kill you. It works, and it works because a solo game never goes near a
network -- the browser plays it (see RealTimeGame.client_clock).

This is the other one, and it exists because the Nokia game cannot be SHARED.

-- what the grid costs on a wire -------------------------------------------

On a grid the smallest error the wire can hand you is one whole CELL. There is
nothing between cell 5 and cell 6, and a cell is precisely the granularity that
decides whether you are alive. A packet 300ms late did not make the game a little
wrong -- it made you dead. Interpolation, buffering, prediction, deciding the move a
tick early: every one of them was an attempt to hide a quantum the same size as the
game, and none of them could.

Here the head is at (11.37, 4.02), it turns where you ask rather than at the next
square, and it eats an apple by running into it. That same 300ms is now worth a fifth
of a unit -- a smudge nobody can see, changing the TIMING of a collision by
milliseconds instead of flipping whether it happened.

That is the property the .io games have and the grid cannot: not smoothness,
FORGIVENESS.

-- no edges ---------------------------------------------------------------

The world wraps. Off the top, on at the bottom. So nothing kills you but a snake --
which is what a shared game wants, and what a wall was only ever standing in for.

It is a torus, not a sphere, and the difference is not pedantry: a real sphere means
great circles, great circles mean sin and cos, and trigonometry is where the two
simulations stop agreeing (see below). A wrap is `x mod BOARD` -- arithmetic, exact,
and free.

-- floats are fine. sin, cos and sqrt are not. -----------------------------

The browser plays a solo game itself and the server replays it to check the score,
and a rollback for a shared game would need the same. Both rest on the two
simulations agreeing EXACTLY.

So every number here moves through + - * / only, on IEEE-754 doubles, which Python
and JavaScript specify identically to the last bit. Distances are compared SQUARED so
no square root is ever taken. There is no angle anywhere -- which is exactly why this
snake turns in four directions and not through a circle, and why it is not a slither
clone. tests/test_determinism.py proves it with no tolerance at all.
"""

from __future__ import annotations

import contextlib
import secrets
from dataclasses import dataclass

from ._rng import Rng
from .base import InvalidMove, RealTimeGame, Result

BOARD = 24.0
SPEED = 6.0  # units per second -- and NOT the tick rate, which is the whole point
TICK_HZ = 20.0

START_LENGTH = 3.0
GROWTH = 2.0
APPLES = 5

HEAD_R = 0.45
BODY_R = 0.40
APPLE_R = 0.40

# How much of your own body, back from the head, cannot kill you.
NECK = 1.6

# How far you must travel between one turn and the next.
#
# The grid gave this for free. Off it, turn -- and then turn again inside your own
# width -- and the snake is running parallel to itself a fifth of a unit away when it
# is four fifths of a unit wide. It is inside itself. No neck length fixes that, it is
# geometry, and every game with a body and a free heading answers it the same way: a
# minimum turning radius. slither caps how fast you swing round; four directions means
# ours is a DISTANCE, and it is the separation two parallel runs need to not touch.
#
# It is SOFT. Asked too early, a turn is remembered rather than refused, and taken the
# moment it is legal. An early press still works; a late one turns you a little further
# along. The grid's discipline, without the grid's fatal quantum.
MIN_TURN = 1.0

DIRECTIONS = {
    "up": (0.0, -1.0),
    "down": (0.0, 1.0),
    "left": (-1.0, 0.0),
    "right": (1.0, 0.0),
}


def _reach2(a: float, b: float) -> float:
    return (a + b) * (a + b)


def _near2(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    """Squared distance from a point to a segment, ON A TORUS.

    The short way round, which means trying the segment where it is and also shifted a
    whole board left, right, up and down, and keeping the closest. Nine translations,
    a handful of segments: the cost is nothing and the alternative is a snake that
    cannot be killed by its own body just because the body is across the seam.
    """
    best = -1.0

    for ox in (-BOARD, 0.0, BOARD):
        for oy in (-BOARD, 0.0, BOARD):
            sx, sy = ax + ox, ay + oy
            ex, ey = bx + ox, by + oy

            vx, vy = ex - sx, ey - sy
            wx, wy = px - sx, py - sy

            span = vx * vx + vy * vy
            if span == 0.0:
                near = wx * wx + wy * wy
            else:
                along = (wx * vx + wy * vy) / span
                if along < 0.0:
                    along = 0.0
                elif along > 1.0:
                    along = 1.0
                dx = px - (sx + vx * along)
                dy = py - (sy + vy * along)
                near = dx * dx + dy * dy

            if best < 0.0 or near < best:
                best = near

    return best


@dataclass
class SnakeBody:
    """A snake is a PATH, and the path is broken wherever it crosses the seam.

    `strokes` is a list of polylines, newest first, and the head is strokes[0][0]. A
    stroke never wraps -- it stops at the edge, and the next one starts on the far
    side. Which means every segment is an honest straight line: it can be stroked onto
    a canvas as it is, and no collision test has to wonder whether a body that runs
    from x=23.9 to x=0.1 is a hair long or a whole board long.
    """

    strokes: list[list[list[float]]]
    heading: str
    pending: str = ""
    length: float = START_LENGTH
    growing: float = 0.0
    alive: bool = True
    straight: float = MIN_TURN
    apples: int = 0  # ...eaten. The score.

    def __post_init__(self) -> None:
        self.pending = self.pending or self.heading

    @property
    def head(self) -> list[float]:
        return self.strokes[0][0]

    def segments(self):
        """Every straight piece of body, nearest the head first."""
        for stroke in self.strokes:
            for i in range(len(stroke) - 1):
                yield stroke[i], stroke[i + 1]


class Snakes(RealTimeGame):
    key = "snakes"
    title = "Snakes"
    category = "arcade"
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
        self.rng = Rng(self.seed)
        self.snakes = []

        seats = len(self.players)
        for seat in range(seats):
            row = BOARD * (seat + 1) / (seats + 1)
            self.snakes.append(
                SnakeBody(
                    strokes=[[[START_LENGTH + 1.0, row], [1.0, row]]], heading="right"
                )
            )

        self.apples = []
        for _ in range(APPLES):
            self._grow_an_apple()

    def _clear(self, x: float, y: float, clearance: float) -> bool:
        for apple in self.apples:
            if _near2(x, y, apple[0], apple[1], apple[0], apple[1]) < _reach2(
                clearance, APPLE_R
            ):
                return False

        for snake in self.snakes:
            if not snake.alive:
                continue
            for a, b in snake.segments():
                if _near2(x, y, a[0], a[1], b[0], b[1]) < _reach2(clearance, BODY_R):
                    return False
        return True

    def _grow_an_apple(self) -> None:
        """Somewhere free, by rejection, in a BOUNDED number of tries -- the browser
        takes exactly as many, off exactly the same generator."""
        for _ in range(64):
            x = self.rng.unit() * BOARD
            y = self.rng.unit() * BOARD
            if self._clear(x, y, APPLE_R):
                self.apples.append([x, y])
                return

    # -- input is intent, not action --------------------------------------

    def _apply(self, seat: int, move: dict) -> None:
        heading = move.get("dir")
        if heading not in DIRECTIONS:
            raise InvalidMove("snakes.unknown_direction")

        snake = self.snakes[seat]
        if not snake.alive:
            raise InvalidMove("snakes.dead")

        dx, dy = DIRECTIONS[heading]
        cx, cy = DIRECTIONS[snake.heading]
        if dx == -cx and dy == -cy:
            raise InvalidMove("snakes.no_reverse")

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

        # Everybody moves before anybody dies, so two heads meeting kill each other.
        for snake in [s for s in living if self._crashed(s)]:
            snake.alive = False

        for snake in living:
            if snake.alive:
                self._eat(snake)

        self._settle()

    def _advance(self, snake: SnakeBody, step: float) -> None:
        if snake.pending != snake.heading and snake.straight >= MIN_TURN:
            head = snake.head
            snake.strokes[0].insert(0, [head[0], head[1]])  # a corner
            snake.heading = snake.pending
            snake.straight = 0.0

        snake.straight += step

        dx, dy = DIRECTIONS[snake.heading]
        head = snake.head
        x, y = head[0] + dx * step, head[1] + dy * step

        # Off an edge and on at the other. The stroke STOPS at the seam and a new one
        # starts across it: a body that ran from x=23.9 to x=0.1 as one segment would
        # be drawn straight across the board and would kill anything it crossed.
        if x < 0.0 or x >= BOARD or y < 0.0 or y >= BOARD:
            edge = 0.0 if (dx < 0 or dy < 0) else BOARD
            if dx != 0.0:
                head[0] = edge  # finish the old stroke exactly on the seam
                entry = [BOARD - edge, head[1]]
            else:
                head[1] = edge
                entry = [head[0], BOARD - edge]

            over = abs(x - head[0]) + abs(y - head[1])  # how far past the seam we got
            snake.strokes.insert(
                0, [[entry[0] + dx * over, entry[1] + dy * over], entry]
            )
        else:
            head[0], head[1] = x, y

        if snake.growing > 0.0:
            grown = step if step < snake.growing else snake.growing
            snake.length += grown
            snake.growing -= grown

        self._trim(snake)

    def _trim(self, snake: SnakeBody) -> None:
        """Cut the tail back so the whole path is exactly `length` units long."""
        left = snake.length
        strokes: list[list[list[float]]] = []

        for stroke in snake.strokes:
            kept: list[list[float]] = []
            done = False

            for i in range(len(stroke) - 1):
                a, b = stroke[i], stroke[i + 1]
                span = abs(b[0] - a[0]) + abs(b[1] - a[1])  # axis-aligned: exact
                kept.append(a)

                if span >= left:
                    if span == 0.0:
                        kept.append([a[0], a[1]])
                    else:
                        part = left / span
                        kept.append(
                            [a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part]
                        )
                    left = 0.0
                    done = True
                    break
                left -= span

            if not done:
                kept.append(stroke[-1])

            if len(kept) > 1:
                strokes.append(kept)
            if done:
                break

        snake.strokes = strokes or [[list(snake.head), list(snake.head)]]

    def _crashed(self, snake: SnakeBody) -> bool:
        x, y = snake.head  # no walls: there is nothing to hit but a snake

        for other in self.snakes:
            if not other.alive:
                continue
            skip = NECK if other is snake else 0.0
            if self._touches(x, y, other, skip):
                return True
        return False

    def _touches(self, x: float, y: float, other: SnakeBody, skip: float) -> bool:
        walked = 0.0

        for a, b in other.segments():
            span = abs(b[0] - a[0]) + abs(b[1] - a[1])

            if walked + span <= skip:
                walked += span
                continue

            ax, ay = a[0], a[1]
            if walked < skip and span > 0.0:
                part = (skip - walked) / span
                ax = a[0] + (b[0] - a[0]) * part
                ay = a[1] + (b[1] - a[1]) * part

            if _near2(x, y, ax, ay, b[0], b[1]) < _reach2(HEAD_R, BODY_R):
                return True

            walked += span

        return False

    def _eat(self, snake: SnakeBody) -> None:
        x, y = snake.head

        for apple in list(self.apples):
            # Overlap is enough. You RUN INTO an apple; there is nowhere to land.
            if _near2(x, y, apple[0], apple[1], apple[0], apple[1]) < _reach2(
                HEAD_R, APPLE_R
            ):
                self.apples.remove(apple)
                snake.growing += GROWTH
                snake.apples += 1
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
            self.finish(Result.draw())

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
            "speed": SPEED,
            "headR": HEAD_R,
            "bodyR": BODY_R,
            "appleR": APPLE_R,
            "seed": self.seed,
            "apples": [[a[0], a[1]] for a in self.apples],
            "seconds": self.elapsed,
            "snakes": [
                {
                    "player": self.players[seat],
                    # Strokes, not cells: the path, broken wherever it crosses the seam.
                    "strokes": [[[p[0], p[1]] for p in s] for s in snake.strokes],
                    "heading": snake.heading,
                    "alive": snake.alive,
                    "length": snake.length,
                    "apples": snake.apples,
                }
                for seat, snake in enumerate(self.snakes)
            ],
        }


def replay(seed: int, players: list[str], moves: list[dict], ticks: int) -> Snakes:
    game = Snakes(seed=seed)
    for player in players:
        game.add_player(player)
    game.start()
    game.run(moves, ticks)
    return game
