// A random number generator that the browser and Python can both agree on.
//
// The twin of waiting_games/games/_rng.py, and it has to stay its twin: the
// browser runs a solo game itself, and it has to grow the SAME apples in the SAME
// cells as the server, or the server's replay of your run will not match the run
// you actually played. Python's `random` is a Mersenne Twister and there is no
// such thing here, so both sides use a generator small enough to write twice --
// thirty-two bits of state and three shifts -- and a test runs both and compares
// the sequences rather than trusting that they look alike.
//
// It is not cryptographic and does not need to be. It picks apples.

export function rng(seed) {
  // Zero is xorshift's fixed point: seeded with it, it returns zero for ever, and
  // every apple in the game grows in the same corner. The one seed it cannot have.
  let state = (seed >>> 0) || 0x9e3779b9;

  const next = () => {
    state ^= (state << 13) >>> 0;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= (state << 5) >>> 0;
    state >>>= 0;
    return state;
  };

  return {
    next,
    // 0 <= n < bound. Modulo, and its bias, is fine here: 576 cells against four
    // billion states.
    below: (bound) => next() % bound,

    // 0.0 <= n < 1.0, and it must be the SAME double Python produces. The snake is
    // off the grid, so an apple lands on a real coordinate rather than in a square,
    // and this side has to put it in exactly the same place. Dividing a 32-bit
    // integer by 2**32 is exact in IEEE-754 -- 32 bits of significand into a slot
    // with 53 -- so both languages give the identical value, bit for bit, and no
    // rounding rule has to be trusted.
    unit: () => next() / 4294967296.0,
  };
}
