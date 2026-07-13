"""Pong for up to four: one wall each. Empty walls bounce. Last one standing wins.

Everything is in a unit square (0..1), so the client can draw it at any size and
the physics never has to know about pixels.

Seats claim walls in order: left, right, top, bottom. A wall nobody claimed --
and a wall whose player is out of lives -- is SOLID and simply bounces the ball,
which is what makes 2-player and 3-player Pong work without a special case.

The client sends its paddle INTENT (-1, 0, +1), never a position. Sending a
position would be both trivially cheatable and a message per frame; intent is one
message per key press, and tick() integrates it.
"""

from __future__ import annotations

import math
import random

from .base import InvalidMove, RealTimeGame, Result

WALLS = ("left", "right", "top", "bottom")
LIVES = 3

BALL_RADIUS = 0.015
BALL_SPEED = 0.45  # units per second
SPEED_UP = 1.03  # each paddle hit makes it a little nastier
MAX_SPEED = 1.1

PADDLE_HALF = 0.09  # half the paddle's length
PADDLE_SPEED = 0.85  # units per second


class Paddle:
    def __init__(self, wall: str) -> None:
        self.wall = wall
        self.position = 0.5  # along its wall
        self.drift = 0  # -1, 0 or +1: the intent tick() integrates
        self.lives = LIVES

    @property
    def out(self) -> bool:
        return self.lives <= 0


class Pong(RealTimeGame):
    key = "pong"
    title = "Pong"
    min_players = 2
    max_players = 4
    tick_hz = 30.0

    def __init__(self) -> None:
        super().__init__()
        self.paddles: list[Paddle] = []
        self.rng = random.Random()
        self.ball = [0.5, 0.5]
        self.velocity = [0.0, 0.0]
        self.rally = 0

    def _on_start(self) -> None:
        self.paddles = [Paddle(WALLS[seat]) for seat in range(len(self.players))]
        self._serve()

    def _serve(self) -> None:
        """Drop the ball back in the middle, heading somewhere awkward."""
        self.ball = [0.5, 0.5]
        angle = self.rng.uniform(0, 2 * math.pi)
        self.velocity = [BALL_SPEED * math.cos(angle), BALL_SPEED * math.sin(angle)]

        # A ball travelling almost exactly along an axis is dull, and can rally
        # between two solid walls forever. Nudge it off the axis.
        for axis in (0, 1):
            if abs(self.velocity[axis]) < 0.25 * BALL_SPEED:
                self.velocity[axis] = math.copysign(
                    0.25 * BALL_SPEED, self.velocity[axis] or 1
                )

        self.rally = 0

    # -- input is intent, not action --------------------------------------

    def _apply(self, seat: int, move: dict) -> None:
        drift = move.get("paddle")
        if isinstance(drift, bool) or drift not in (-1, 0, 1):
            raise InvalidMove("invalid input")

        paddle = self.paddles[seat]
        if paddle.out:
            raise InvalidMove("you are out of the game")

        paddle.drift = drift  # tick() is what actually moves it

    # -- the clock --------------------------------------------------------

    def tick(self, dt: float) -> None:
        for paddle in self.paddles:
            if paddle.out:
                continue
            paddle.position = _clamp(
                paddle.position + paddle.drift * PADDLE_SPEED * dt,
                PADDLE_HALF,
                1.0 - PADDLE_HALF,
            )

        self.ball[0] += self.velocity[0] * dt
        self.ball[1] += self.velocity[1] * dt

        self._walls()
        self._settle()

    def _defender(self, wall: str) -> Paddle | None:
        """Whoever is defending this wall, if anyone still is."""
        for paddle in self.paddles:
            if paddle.wall == wall and not paddle.out:
                return paddle
        return None

    def _walls(self) -> None:
        # Every wall the ball is past, not just the first. In a corner it is past
        # TWO of them at once, and handling only one would leave it hanging
        # outside the box on the other axis until the next tick.
        for wall, axis in (("left", 0), ("right", 0), ("top", 1), ("bottom", 1)):
            x, y = self.ball
            beyond = {
                "left": x < BALL_RADIUS,
                "right": x > 1 - BALL_RADIUS,
                "top": y < BALL_RADIUS,
                "bottom": y > 1 - BALL_RADIUS,
            }[wall]
            if not beyond:
                continue

            # Where along the wall the ball crossed it.
            coordinate = y if axis == 0 else x
            defender = self._defender(wall)

            # Nobody's wall, or a wall whose player is out: it is just a wall.
            if defender is None:
                self._bounce(axis, wall)
                continue

            if abs(coordinate - defender.position) <= PADDLE_HALF + BALL_RADIUS:
                # Saved. Steer with the paddle: the further from its middle you
                # catch the ball, the more angle you put on it.
                offset = (coordinate - defender.position) / PADDLE_HALF
                self.velocity[1 - axis] += offset * 0.35 * BALL_SPEED
                self._bounce(axis, wall)
                self.rally += 1
                self._speed_up()
                continue

            # Missed. The ball is gone; nothing else about this tick matters.
            defender.lives -= 1
            self._serve()
            return

    def _bounce(self, axis: int, wall: str) -> None:
        self.velocity[axis] = -self.velocity[axis]
        # Put it back inside the box, or a slow ball can stick to the wall and
        # flip its velocity every tick.
        if wall in ("left", "top"):
            self.ball[axis] = BALL_RADIUS
        else:
            self.ball[axis] = 1 - BALL_RADIUS

    def _speed_up(self) -> None:
        speed = math.hypot(self.velocity[0], self.velocity[1])
        if not speed:
            return
        target = min(speed * SPEED_UP, MAX_SPEED)
        self.velocity[0] *= target / speed
        self.velocity[1] *= target / speed

    def _settle(self) -> None:
        standing = [seat for seat, paddle in enumerate(self.paddles) if not paddle.out]
        if len(standing) == 1:
            self.finish(Result(winner_seat=standing[0]))
        elif not standing:
            self.finish(Result.draw())

    # -- what everyone sees -----------------------------------------------

    def public_state(self) -> dict:
        return {
            "ball": [round(self.ball[0], 4), round(self.ball[1], 4)],
            "radius": BALL_RADIUS,
            "paddleHalf": PADDLE_HALF,
            "rally": self.rally,
            "paddles": [
                {
                    "player": self.players[seat],
                    "wall": paddle.wall,
                    "position": round(paddle.position, 4),
                    "lives": max(0, paddle.lives),
                    "out": paddle.out,
                }
                for seat, paddle in enumerate(self.paddles)
            ],
            # Walls nobody defends -- unclaimed, or their player is out. The
            # client draws them solid so it is obvious why the ball came back.
            "solid": [wall for wall in WALLS if self._defender(wall) is None],
        }


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))
