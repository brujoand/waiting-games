// The snake slides between ticks instead of teleporting a whole cell eight times
// a second. This is the arithmetic that does it.
//
// Worth testing for the same reason _geometry.js is: it is a few lines of index
// juggling that are either exactly right or subtly, invisibly wrong, and "the
// snake looks a bit odd" is not a bug report anyone can act on. Both of the bugs
// pinned below shipped, and neither was visible in any test that existed.

import assert from "node:assert/strict";
import { test } from "node:test";

import { at, timeline } from "../waiting_games/static/games/_interpolate.js";

const HZ = 8;
const TICK = 1000 / HZ; // 125ms

// -- at(): sliding one segment between two states ---------------------------

const BEFORE = { cells: [[5, 5], [4, 5], [3, 5]] };
const AFTER = { cells: [[6, 5], [5, 5], [4, 5]] };

test("half way through a tick, every segment is half way to the next cell", () => {
  assert.deepEqual(at(AFTER, BEFORE, 0, 0.5), [5.5, 5]);
  assert.deepEqual(at(AFTER, BEFORE, 1, 0.5), [4.5, 5]);
  assert.deepEqual(at(AFTER, BEFORE, 2, 0.5), [3.5, 5]);
});

test("the ends of the slide are exactly the two states the server sent", () => {
  for (let index = 0; index < AFTER.cells.length; index += 1) {
    assert.deepEqual(at(AFTER, BEFORE, index, 0), BEFORE.cells[index]);
    assert.deepEqual(at(AFTER, BEFORE, index, 1), AFTER.cells[index]);
  }
});

test("the body follows the head rather than cutting the corner", () => {
  // Turning up: the head goes north, but the segment behind it is still finishing
  // the move the head made last tick. Each segment travels to where the one ahead
  // of it WAS -- one cell, orthogonally -- so nothing ever slides diagonally.
  const before = { cells: [[5, 5], [4, 5], [3, 5]] };
  const after = { cells: [[5, 4], [5, 5], [4, 5]] };

  assert.deepEqual(at(after, before, 0, 0.5), [5, 4.5]); // head: north
  assert.deepEqual(at(after, before, 1, 0.5), [4.5, 5]); // body: still east
  assert.deepEqual(at(after, before, 2, 0.5), [3.5, 5]);
});

test("a snake that just ate does not stretch its new tail across the board", () => {
  // Growing keeps the tail, so the snake is one cell longer and the LAST segment
  // has no previous position. Interpolating it from nowhere -- or worse, from
  // index 0 -- would smear it across the map. It must snap.
  const before = { cells: [[5, 5], [4, 5]] };
  const grown = { cells: [[6, 5], [5, 5], [4, 5]] };

  assert.deepEqual(at(grown, before, 2, 0.5), [4, 5], "the new tail must not move");
  assert.deepEqual(at(grown, before, 0, 0.5), [5.5, 5], "...but the head still slides");
});

test("with no previous state at all, a snake is drawn where it is", () => {
  for (const before of [null, undefined, {}, { cells: [] }]) {
    assert.deepEqual(at(AFTER, before, 0, 0.5), [6, 5]);
  }
});

// -- timeline(): the buffer, and the clock that reads it --------------------
//
// This is what janked. The old renderer slid between the last two states across
// the gap it MEASURED between their arrivals, which meant the animation inherited
// the network's jitter directly and could not survive a dropped state at all.
// Every test below is a way that used to go wrong.

// A snake walking right, one cell per tick, so the drawn head position is a
// direct readout of how smooth the motion is.
const stateAt = (tick) => ({ cells: [[tick, 5]] });

/** Where the head is drawn at time `now`. */
function head(clock, now) {
  const frame = clock.read(now);
  if (!frame) return null;
  const snake = frame.after;
  const was = frame.before;
  return at(snake, was, 0, frame.alpha)[0];
}

/** Feed a stream of arrivals, sample the drawn head every frame, return speeds. */
function play({ jitter = () => 0, drop = [], ticks = 30 }) {
  const clock = timeline(HZ);
  const FRAME = 1000 / 60;
  const samples = [];

  let now = 0;
  const end = ticks * TICK;
  let next = 0;

  while (now < end) {
    // deliver every state whose arrival time has passed
    while (next < ticks && next * TICK + jitter(next) <= now) {
      if (!drop.includes(next)) clock.accept(stateAt(next), next, next * TICK + jitter(next));
      next += 1;
    }
    const h = head(clock, now);
    if (h !== null) samples.push(h);
    now += FRAME;
  }

  const speeds = [];
  for (let i = 1; i < samples.length; i += 1) {
    speeds.push(Math.abs(samples[i] - samples[i - 1]));
  }
  const nominal = FRAME / TICK; // cells per frame at the correct speed
  return {
    worst: Math.max(...speeds) / nominal, // in multiples of normal speed
    jumps: speeds.filter((s) => s > nominal * 2).length,
    clock,
  };
}

test("a clean stream is drawn at exactly one cell per tick, with no jumps", () => {
  const { worst, jumps } = play({});
  assert.equal(jumps, 0);
  assert.ok(worst <= 1.05, `worst frame was ${worst.toFixed(2)}x normal speed`);
});

test("wifi jitter is absorbed by the buffer, not drawn", () => {
  // THE BUG. Arrival times wobbling by +-20ms used to wobble the snake with them,
  // because the slide was anchored to when the packet landed. Nine visible jumps
  // in twenty ticks, and not an apple in sight.
  const wobble = [-20, 12, -6, 18, 3, -15, 9, -11, 20, -3];
  const { worst, jumps } = play({ jitter: (k) => wobble[k % wobble.length] });

  assert.equal(jumps, 0, "jitter must not reach the screen");
  assert.ok(worst <= 1.1, `worst frame was ${worst.toFixed(2)}x normal speed`);
});

test("a dropped state is glided across, not teleported over", () => {
  // THE OTHER BUG, and the one that needed the tick index on the wire. lobby's
  // stream() drops a frame at a socket that is still busy -- on purpose. The old
  // renderer slid two cells across the doubled gap, then got cut off halfway by
  // the next state and snapped the rest: a full-square teleport.
  const { worst, jumps } = play({ drop: [10] });

  assert.equal(jumps, 0, "a dropped state must not teleport the snake");
  assert.ok(worst <= 1.1, `worst frame was ${worst.toFixed(2)}x normal speed`);
});

test("even jitter AND a dropped state together stay smooth", () => {
  const wobble = [-20, 12, -6, 18, 3, -15, 9, -11, 20, -3];
  const { worst, jumps } = play({
    jitter: (k) => wobble[k % wobble.length],
    drop: [10, 21],
  });

  assert.equal(jumps, 0);
  assert.ok(worst <= 1.2, `worst frame was ${worst.toFixed(2)}x normal speed`);
});

test("a healthy connection is not made to pay for a delay it does not need", () => {
  // The delay is latency: every millisecond of it is a millisecond later that you
  // see your own turn. On a clean line it must stay near the one-tick floor.
  const { clock } = play({});
  const { delayTicks } = clock.debug();

  assert.ok(delayTicks < 1.3, `clean line should not buffer ${delayTicks} ticks`);
  assert.ok(delayTicks >= 1, "one tick is the floor: you need the state either side");
});

test("a bad connection buys itself more buffer, and gives it back afterwards", () => {
  const clock = timeline(HZ);
  // A clean run, then a state goes missing, then clean again.
  for (let k = 0; k < 6; k += 1) clock.accept(stateAt(k), k, k * TICK);
  const calm = clock.debug().delayTicks;

  clock.accept(stateAt(7), 7, 7 * TICK); // 6 never arrived
  const rattled = clock.debug().delayTicks;
  assert.ok(rattled > calm, "a dropped state must widen the buffer");

  for (let k = 8; k < 400; k += 1) clock.accept(stateAt(k), k, k * TICK);
  const recovered = clock.debug().delayTicks;
  assert.ok(recovered < rattled, "and a long calm spell must give the latency back");
});

test("a state that carries no new tick is ignored", () => {
  // Someone opening the page triggers a state push that is not a tick. It used to
  // restart the slide, so every player's snake stuttered when anybody joined.
  const clock = timeline(HZ);
  clock.accept(stateAt(0), 0, 0);
  clock.accept(stateAt(1), 1, TICK);
  const before = clock.debug();

  clock.accept(stateAt(1), 1, TICK + 40); // a re-send of the same tick
  assert.deepEqual(clock.debug(), before, "a re-sent tick must change nothing");
});

test("the world never runs backwards", () => {
  // Re-anchoring the clock to a faster path could otherwise rewind time, which
  // reads as a stutter of exactly the kind we are here to remove.
  const clock = timeline(HZ);
  for (let k = 0; k < 5; k += 1) clock.accept(stateAt(k), k, k * TICK + 30);
  const early = head(clock, 5 * TICK);

  clock.accept(stateAt(5), 5, 5 * TICK); // arrives with no delay at all
  const later = head(clock, 5 * TICK + 1);

  assert.ok(later >= early, `the snake went backwards: ${early} -> ${later}`);
});
