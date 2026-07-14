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

BALL_RADIUS = 0.024
BALL_SPEED = 0.45  # units per second
SPEED_UP = 1.03  # each paddle hit makes it a little nastier
MAX_SPEED = 1.1

PADDLE_HALF = 0.12  # half the paddle's length, along its wall
PADDLE_SPEED = 0.85  # units per second

# How far the paddle stands out from its wall -- and this is REAL, not a drawing
# trick: the ball turns around at the paddle's face, not at the wall behind it.
#
# The renderer used to draw a 2%-thick paddle over a collision that happened at
# the wall, so at the moment of contact the ball was already a third of the way
# through the bat. Making the paddle bigger without making it real would only
# have made that worse. A thickness the physics agrees with is the same amount of
# code and it cannot drift apart.
#
# The face is therefore also the goal line: get past it and the point is gone,
# which is what a paddle IS. The ball no longer flies the last 3% to the wall to
# be judged there, and nothing about that is visible except that the miss reads
# as "you were beaten" rather than "the wall ate it".
PADDLE_THICK = 0.03


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
            raise InvalidMove("pong.bad_input")

        paddle = self.paddles[seat]
        if paddle.out:
            raise InvalidMove("pong.out")

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

    def _face(self, wall: str) -> float:
        """How far in from `wall` the ball turns around.

        A defended wall has a paddle standing on it, and the ball meets the front
        of the paddle. An undefended one is bare, and the ball meets the wall.
        """
        stand = PADDLE_THICK if self._defender(wall) is not None else 0.0
        return stand + BALL_RADIUS

    def _walls(self) -> None:
        # Every wall the ball is past, not just the first. In a corner it is past
        # TWO of them at once, and handling only one would leave it hanging
        # outside the box on the other axis until the next tick.
        for wall, axis in (("left", 0), ("right", 0), ("top", 1), ("bottom", 1)):
            near = wall in ("left", "top")  # the low end of this axis
            face = self._face(wall)

            position = self.ball[axis]
            beyond = position < face if near else position > 1 - face
            if not beyond:
                continue

            # Where ALONG the wall the ball is: the other axis of the two.
            coordinate = self.ball[1 - axis]
            defender = self._defender(wall)

            # Nobody's wall, or a wall whose player is out: it is just a wall.
            if defender is None:
                self._bounce(axis, near, face)
                continue

            if abs(coordinate - defender.position) <= PADDLE_HALF + BALL_RADIUS:
                # Saved. Steer with the paddle: the further from its middle you
                # catch the ball, the more angle you put on it.
                offset = (coordinate - defender.position) / PADDLE_HALF
                self.velocity[1 - axis] += offset * 0.35 * BALL_SPEED
                self._bounce(axis, near, face)
                self.rally += 1
                self._speed_up()
                continue

            # Past the face, and not on the paddle: it went by. The paddle is the
            # goal line, so there is nothing behind it left to hit.
            defender.lives -= 1
            self._serve()
            return

    def _bounce(self, axis: int, near: bool, face: float) -> None:
        self.velocity[axis] = -self.velocity[axis]
        # Put it back on the face, or a slow ball can sink into the paddle and
        # flip its velocity every tick without ever getting out.
        self.ball[axis] = face if near else 1 - face

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
            "paddleThick": PADDLE_THICK,
            "rally": self.rally,
            "paddles": [
                {
                    "player": self.players[seat],
                    "wall": paddle.wall,
                    "position": round(paddle.position, 4),
                    "lives": max(0, paddle.lives),
                    "out": paddle.out,
                    # Whether this player is leaning on the controls right now.
                    # It is the DRIFT, not the movement: a paddle held against the
                    # end of its wall has stopped moving and is still being held,
                    # and those are the moments a player most needs telling that
                    # the game can hear them.
                    #
                    # Sent for every paddle rather than kept on the client that
                    # pressed the key, because it is worth seeing your opponent
                    # commit to a direction -- and because the client would
                    # otherwise be keeping its own copy of a thing the server
                    # already knows, free to disagree with it.
                    "held": paddle.drift != 0,
                }
                for seat, paddle in enumerate(self.paddles)
            ],
            # Walls nobody defends -- unclaimed, or their player is out. The
            # client draws them solid so it is obvious why the ball came back.
            "solid": [wall for wall in WALLS if self._defender(wall) is None],
        }


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))
