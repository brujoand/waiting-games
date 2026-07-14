// Sliding a smooth game between the states the server has already agreed on.
//
// DOM-free, so it can be unit-tested -- the same reason _geometry.js exists.
// Pong's rotation maths was silently wrong for two of its four walls, and it
// stayed wrong because nothing could test it without a browser. This is the same
// shape of code: a small piece of arithmetic that is either right or subtly,
// invisibly wrong, and "the snake looks a bit odd" is not a bug report anyone
// can act on.
//
// -- why this is a BUFFER and not just a lerp ------------------------------
//
// The obvious thing -- keep the last two states, slide from one to the other
// across the gap you measured between them -- is what used to be here, and it
// janks. Both halves of it are wrong:
//
//   The gap you measure is not the gap the server sent. It carries every hiccup
//   between the tick loop and this line: scheduler jitter, a busy socket, wifi.
//   Sliding over a span 10ms too long leaves the snake 8% short of its cell when
//   the next state lands on time, and it JUMPS the rest -- which is the exact
//   thing sliding exists to remove.
//
//   Anchoring the slide to ARRIVAL TIME means the animation inherits the
//   network's jitter directly. There is no margin: alpha is supposed to reach 1
//   exactly as the next state lands, so a state that is a millisecond late is
//   already a stall, and one that is early is already a jump.
//
// And neither survives a DROPPED state, which is not a hypothetical: lobby's
// stream() deliberately drops a frame at any socket still busy with the last
// one. Two ticks then arrive as one gap, the snake slides two cells across it,
// and the next state cuts the slide off halfway -- a full-square teleport.
//
// So do what netcode has always done: keep a BUFFER of the states, and render
// the world as it was a short while ago, from a clock of our own. Every state we
// need has then already arrived, and jitter is absorbed by the delay instead of
// being drawn. The cost is that delay -- so it is kept as small as the
// connection allows, and grown only when the connection earns it.

// One tick is the floor: to draw a moment you need the state on EITHER side of
// it, so you can never be less than one tick behind and still have the far side.
const FLOOR_TICKS = 1;

// Never fall further behind than this, however bad it gets. Past here the game
// is unplayable anyway, and holding is honest where a minute of lag is not.
const CEILING_TICKS = 6;

// Enough margin to cover a frame or two of ordinary scheduling noise, so a
// healthy connection does not keep re-learning that it is healthy.
const SAFETY_TICKS = 0.15;

// How fast the delay forgets. It grows INSTANTLY -- a jump you have already
// drawn cannot be un-drawn -- and shrinks slowly, so one bad moment does not
// leave the game laggy forever, and a flaky connection does not oscillate.
const FORGET = 0.995;

// Only used when the server has not said how fast it ticks.
const ASSUMED_TICK_MS = 125;

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

/**
 * A buffer of server states, and a clock that reads the world out of it.
 *
 * accept(state, tick, now) -- a state arrived, carrying the server's tick index.
 * read(now)                -- {before, after, alpha} to draw, or null.
 */
export function timeline(tickHz) {
  const tickMs = tickHz ? 1000 / tickHz : ASSUMED_TICK_MS;
  const states = []; // {tick, state}, ascending

  // The local time at which tick 0 would have arrived, had every state come
  // down the wire with no delay at all. Every arrival votes on it.
  let origin = null;
  let newest = null;

  // What the connection has cost us lately, measured in ticks. `late` is how far
  // behind the ideal an arrival was; `gap` is the widest hole in the tick
  // sequence, which is how many ticks a single missing state is worth.
  let late = 0;
  let gap = 1;

  // Where we last DREW -- which is not always where we wanted to be. Time must
  // not run backwards (re-anchoring origin to a faster path would otherwise
  // rewind the world), and just as importantly, a moment we could not draw is a
  // moment we must not later pretend we had: if the state we needed had not
  // arrived, we held, and we resume from where we HELD rather than snapping
  // forward to where the clock ran off to without us.
  let last = null;

  function delayTicks() {
    // To draw tick position p, the state at ceil(p) must ALREADY be here. It
    // arrives `late` behind the ideal, and the next one we actually hold may be
    // `gap` ticks further on. So this is not a tuning knob -- it is the smallest
    // delay for which the state we need is guaranteed to have arrived.
    return clamp(gap + late + SAFETY_TICKS, FLOOR_TICKS, CEILING_TICKS);
  }

  return {
    accept(state, tick, now) {
      if (newest !== null && tick <= newest) return; // stale or a re-send

      // An arrival that beats every previous one defines the fastest path we
      // have seen; anything slower is lateness, not a new clock. Let origin
      // drift towards the slow side very gently, so a genuinely skewing clock is
      // followed and a single early packet does not pin us forever.
      const ideal = now - tick * tickMs;
      if (origin === null || ideal < origin) origin = ideal;
      else origin += (ideal - origin) * 0.002;

      const lateness = (now - (origin + tick * tickMs)) / tickMs;
      const hole = newest === null ? 1 : tick - newest;

      late = Math.max(lateness, late * FORGET);
      gap = Math.max(hole, 1 + (gap - 1) * FORGET);

      states.push({ tick, state });
      newest = tick;

      // Two states either side of the render point is all that is ever drawn.
      // Keep a little history for a delay that has just grown, and no more.
      while (states.length > CEILING_TICKS + 3) states.shift();
    },

    read(now) {
      if (origin === null || states.length === 0) return null;

      let want = (now - origin) / tickMs - delayTicks();
      if (last !== null && want < last) want = last; // never rewind

      let before = null;
      let after = null;
      for (const entry of states) {
        if (entry.tick <= want) before = entry;
        else if (after === null) after = entry;
      }

      // Nothing to slide from, or nothing to slide towards. Holding is the honest
      // failure: draw a state the server really sent, and wait for the one that
      // completes the pair. The delay grows on the next arrival, so the hole is
      // less likely to catch us again.
      //
      // `last` records the HELD position, not the wanted one. Recording the want
      // is what made a dropped state teleport: the clock would sail on past a
      // moment we never drew, and the instant the missing state's successor
      // landed we would snap forward a whole cell to catch up with it.
      if (before === null) {
        last = states[0].tick;
        return { before: null, after: states[0].state, alpha: 1 };
      }
      if (after === null) {
        last = before.tick;
        return { before: null, after: before.state, alpha: 1 };
      }

      last = want;
      const alpha = clamp((want - before.tick) / (after.tick - before.tick), 0, 1);
      return { before: before.state, after: after.state, alpha };
    },

    // For tests, and for anyone wondering why the game feels a step behind.
    debug() {
      return { delayTicks: delayTicks(), late, gap, held: states.length };
    },
  };
}

// Where segment `index` should be drawn, part-way between two states.
//
// Segment i in the NEW state is where segment i-1 was in the OLD one -- the body
// is a queue, and every tick the head pushes onto the front. So segment i slides
// from old[i] to new[i], which are one cell apart, and the whole body crawls: the
// head reaches forward and each segment follows the one ahead of it.
//
// Two cases have no `was` to slide from, and both must SNAP instead:
//
//   - A snake that has just eaten is one cell longer, so its final segment did
//     not exist a tick ago. Sliding it in from nowhere would stretch the snake
//     across the board.
//   - A snake nobody has seen before has no previous state at all.
//
// Returning `now` for both is not a special case so much as the honest answer:
// with nothing to interpolate from, the only place we know it is, is where it is.
export function at(snake, before, index, alpha) {
  const now = snake.cells[index];
  const was = before?.cells?.[index];
  if (!was) return now;

  return [was[0] + (now[0] - was[0]) * alpha, was[1] + (now[1] - was[1]) * alpha];
}
