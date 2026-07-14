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

// -- at(): walking a segment back down the snake's own body ------------------
//
// The body IS the path: cells[i + 1] is where segment i stood a tick ago, because
// the body is a queue and the head pushes onto the front. So one state is all it
// takes to draw a slide -- no previous state required.

const AFTER = { cells: [[6, 5], [5, 5], [4, 5]] };

test("half way through a tick, every segment is half way to the next cell", () => {
  assert.deepEqual(at(AFTER, 0, 0.5), [5.5, 5]);
  assert.deepEqual(at(AFTER, 1, 0.5), [4.5, 5]);
  // The tail has nowhere further back to come from, so it snaps.
  assert.deepEqual(at(AFTER, 2, 0.5), [4, 5]);
});

test("the ends of the slide are exactly the cells the server sent", () => {
  const before = [[5, 5], [4, 5]]; // = AFTER.cells shifted by one
  for (let index = 0; index < before.length; index += 1) {
    assert.deepEqual(at(AFTER, index, 0), before[index]);
    assert.deepEqual(at(AFTER, index, 1), AFTER.cells[index]);
  }
});

test("the body follows the head rather than cutting the corner", () => {
  // Turning up: the head goes north, but the segment behind it is still finishing
  // the move the head made last tick. Each segment travels to where the one ahead
  // of it WAS -- one cell, orthogonally -- so nothing ever slides diagonally.
  const after = { cells: [[5, 4], [5, 5], [4, 5]] };

  assert.deepEqual(at(after, 0, 0.5), [5, 4.5]); // head: north
  assert.deepEqual(at(after, 1, 0.5), [4.5, 5]); // body: still east
});

test("a snake that just ate does not stretch its new tail across the board", () => {
  // Growing keeps the tail, so the snake is one cell longer and the LAST segment
  // has no history behind it. Sliding it in from nowhere would smear it across
  // the map. It must snap.
  const grown = { cells: [[6, 5], [5, 5], [4, 5]] };

  assert.deepEqual(at(grown, 2, 0.5), [4, 5], "the new tail must not move");
  assert.deepEqual(at(grown, 0, 0.5), [5.5, 5], "...but the head still slides");
});

test("a snake that is not moving is drawn where it is", () => {
  // span 0: a corpse, or a snake nobody has seen before. A dead snake dies WITHOUT
  // moving, so its body still reads as a perfectly good path -- walking it would
  // slide the corpse backwards along itself. It has to be told not to.
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(at(AFTER, index, 0.5, 0), AFTER.cells[index]);
  }
});

test("a segment walks THROUGH the corner when a state went missing", () => {
  // THE CORNER-CUT. If a state never arrived, a segment has two cells to cover in
  // one slide. Lerping straight from where it was to where it is would draw a
  // DIAGONAL when the snake turned in between -- and a snake on a diagonal cuts
  // through the corner of a wall, or through its own neck. It must walk the path.
  //
  // The snake went east, then turned north. Two ticks of travel, one slide.
  const after = { cells: [[4, 3], [4, 4], [3, 4], [2, 4]] };
  //                       now     1 ago    2 ago   3 ago

  // Half way is exactly the corner cell -- NOT the diagonal midpoint of [3,4]
  // and [4,3], which would be [3.5, 3.5] and is inside the corner.
  assert.deepEqual(at(after, 0, 0.5, 2), [4, 4], "half way is the corner itself");

  // A quarter of the way: half way along the FIRST leg, still heading east.
  assert.deepEqual(at(after, 0, 0.25, 2), [3.5, 4]);
  // Three quarters: half way along the SECOND leg, now heading north.
  assert.deepEqual(at(after, 0, 0.75, 2), [4, 3.5]);

  // ...and at no point is it ever off the grid lines.
  for (let a = 0; a <= 1; a += 0.05) {
    const [x, y] = at(after, 0, a, 2);
    assert.ok(
      Number.isInteger(x) || Number.isInteger(y),
      `cut the corner at alpha=${a}: drew [${x}, ${y}]`,
    );
  }
});

// -- timeline(): the buffer, and the clock that reads it --------------------
//
// This is what janked. The old renderer slid between the last two states across
// the gap it MEASURED between their arrivals, which meant the animation inherited
// the network's jitter directly and could not survive a dropped state at all.
// Every test below is a way that used to go wrong.

// A snake walking right, one cell per tick, so the drawn head position is a direct
// readout of how smooth the motion is. It trails a real body, because the body is
// the history the renderer walks back through.
const stateAt = (tick) => ({
  cells: Array.from({ length: 8 }, (_, i) => [tick - i, 5]),
});

/** Where the head is drawn at time `now`. */
function head(clock, now) {
  const frame = clock.read(now);
  if (!frame) return null;
  return at(frame.state, 0, frame.alpha, frame.span)[0];
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
  // The delay IS latency: every millisecond of it is a millisecond later that you
  // see your own turn. So a clean line must sit at the floor and not a tick more.
  //
  // 1.5 ticks is 188ms at 8 Hz. Valve's cl_interp defaults to TWO send intervals
  // and Fiedler recommends three -- but they are buying tolerance to packet LOSS,
  // over UDP. A WebSocket is TCP: nothing is lost, only late. So we carry half a
  // tick of slack for jitter and let `gap` adapt to the states the server itself
  // declines to send, rather than paying a whole extra tick up front against a
  // loss that cannot happen.
  const { clock } = play({});
  const { delayTicks } = clock.debug();

  assert.ok(delayTicks >= 1, "one tick is the floor: you need the state either side");
  assert.ok(delayTicks <= 1.5, `clean line should not buffer ${delayTicks} ticks`);
  assert.ok(delayTicks < 2, "...and must stay under the fixed 2-tick delay it replaces");
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

test("a storm does not leave the game permanently a step further behind", () => {
  // The failure a hold-and-resume buffer invites: every hold pushes the render
  // clock further behind the stream, and if it never catches back up, the lag
  // RATCHETS -- the game gets quietly laggier for the rest of the session, for no
  // reason the player can see. Mirror runs a timescale controller to drag it back;
  // this clock instead derives the render point from absolute time, so it converges
  // on its own the moment the delay decays. Either way it has to be proven.
  const clock = timeline(HZ);
  let tick = 0;
  const send = (at) => {
    clock.accept(stateAt(tick), tick, at);
    tick += 1;
  };

  for (; tick < 20; ) send(tick * TICK); // calm
  const calm = clock.debug().delayTicks;

  for (let i = 0; i < 5; i += 1) {
    tick += 1; // a state goes missing
    send(tick * TICK + 60); // ...and the next one limps in late
  }
  assert.ok(clock.debug().delayTicks > calm, "the storm must widen the buffer");

  for (; tick < 900; ) send(tick * TICK); // a long calm spell afterwards

  const settled = clock.debug().delayTicks;
  assert.ok(
    settled <= calm + 0.05,
    `the buffer never gave the latency back: ${calm} -> ${settled} ticks`,
  );

  // ...and the snake is drawn where the settled delay says, not further adrift.
  const now = tick * TICK;
  const drawn = head(clock, now);
  const behind = tick - 1 - drawn; // ticks between the newest state and the pixels
  assert.ok(
    behind <= settled + 0.2,
    `render clock ratcheted: ${behind.toFixed(2)} ticks behind, delay is ${settled}`,
  );
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
