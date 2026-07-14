"""A random number generator that Python and the browser can both agree on.

`random.Random` is a Mersenne Twister, and the browser has no such thing. A game
seeded with it can only ever be replayed on this side of the wire -- which is
fine, right up until the browser has to grow the SAME apples in the SAME cells as
the server, because it is running the game itself.

That is the whole point of the seed, so the generator has to be one we can write
twice and check. Xorshift32 is thirty-two bits of state and three lines of shifts:
short enough to be obviously the same in both languages, and pinned by a test that
runs both and compares the sequences rather than trusting that they look alike.

It is not cryptographic and does not need to be. It picks apples.
"""

from __future__ import annotations

MASK = 0xFFFFFFFF


class Rng:
    def __init__(self, seed: int) -> None:
        # Zero is xorshift's fixed point: seeded with it, it returns zero for
        # ever, and every apple in the game grows in the same corner. It is the
        # one seed the generator cannot have, so it is the one seed we refuse.
        self.state = (seed & MASK) or 0x9E3779B9

    def next(self) -> int:
        x = self.state
        x ^= (x << 13) & MASK
        x ^= x >> 17
        x ^= (x << 5) & MASK
        self.state = x & MASK
        return self.state

    def below(self, bound: int) -> int:
        """0 <= n < bound. Modulo, and the bias that comes with it, is fine here:
        the board is 576 cells and the generator has four billion states."""
        return self.next() % bound

    def unit(self) -> float:
        """0.0 <= n < 1.0, and it must be the SAME double in both languages.

        The snake is off the grid, so an apple lands on a real coordinate rather than
        in a square, and the browser has to put it in exactly the same place. Dividing
        a 32-bit integer by 2**32 is exact in IEEE-754 -- the numerator has 32 bits of
        significand to spend and a double has 53 -- so Python and JavaScript produce
        the identical value, bit for bit, and no rounding rule has to be trusted.
        """
        return self.next() / 4294967296.0
