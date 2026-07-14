// The snake slides between cells instead of teleporting a whole cell six times a
// second. This is the arithmetic that does it.
//
// Worth testing for the same reason _geometry.js is: it is a few lines of index
// juggling that are either exactly right or subtly, invisibly wrong, and "the
// snake looks a bit odd" is not a bug report anyone can act on. Every bug pinned
// below shipped, and none of them was visible in any test that existed.

import assert from "node:assert/strict";
import { test } from "node:test";

import { ahead, at, timeline } from "../waiting_games/static/games/_interpolate.js";

const HZ = 6;
const TICK = 1000 / HZ;

// A snake walking right, one cell per tick, exactly as the server sends it: the
// body it has, and the cell it is about to take. The drawn head is then a direct
// readout of how smooth -- and how CURRENT -- the motion is.
const stateAt = (tick, { alive = true, grows = false, doomed = false } = {}) => ({
  cells: Array.from({ length: 8 }, (_, i) => [tick - i, 5]),
  alive,
  grows,
  next: doomed ? null : [tick + 1, 5],
});

/** Where the head is drawn at time `now` -- whichever way the clock says to walk. */
function head(clock, now) {
  const frame = clock.read(now);
  if (!frame) return null;
  const [x] = frame.ahead
    ? ahead(frame.state, 0, frame.alpha)
    : at(frame.state, 0, frame.alpha, frame.span);
  return x;
}

// -- the cell of lag, which is the whole point -------------------------------

test("the snake on screen is the snake the server has, at every tick rate", () => {
  // THE BUG, and it hid for the same reason it was so bad: every guard in this
  // file was written in TICKS, so the lag read as a constant 1.0 and nobody asked
  // what a tick was worth. A tick is one whole CELL. The snake you were steering
  // was a cell behind the snake the server had -- at 8 Hz, at 6 Hz, at any rate
  // at all, because the lag was a tick and a tick is a cell however long it
  // lasts. Which is exactly why slowing the game down did not make it easier to
  // steer, and never could have.
  //
  // The server sends the cell each snake is about to take, so there is nothing
  // left to wait for. The drawn head is where the server's head is, and it lands
  // on the cell at the moment the server puts it there.
  for (const hz of [8, 6, 4]) {
    const tick = 1000 / hz;
    const clock = timeline(hz);
    for (let k = 0; k <= 40; k += 1) clock.accept(stateAt(k), k, k * tick);

    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const now = (40 + fraction) * tick;
      const drawn = head(clock, now);
      const server = now / tick; // where a snake at one cell per tick really is

      assert.ok(
        Math.abs(drawn - server) < 0.001,
        `${hz} Hz: drawn ${drawn.toFixed(2)}, server ${server.toFixed(2)} -- ` +
          `${(server - drawn).toFixed(2)} cells of lag`,
      );
    }
  }
});

test("a clean line buys no delay at all, because there is nothing left to wait for", () => {
  // The delay IS latency: every millisecond of it is a millisecond later that you
  // see your own turn. It used to be 1.5 ticks and could not be less, because a
  // slide needs the cell it is going TO and only the server knew it. The server
  // says it up front now, so the floor is nought -- and nought is not a tuning
  // choice, it is the absence of anything to wait for.
  const clock = timeline(HZ);
  for (let k = 0; k < 40; k += 1) clock.accept(stateAt(k), k, k * TICK);

  assert.equal(clock.debug().delayTicks, 0);
});

// -- ahead(): walking the body FORWARDS, into the move the server sent --------

const MOVING = stateAt(6); // head on [6,5], about to take [7,5]

test("the head goes where the server said, and the body takes its place", () => {
  assert.deepEqual(ahead(MOVING, 0, 0.5), [6.5, 5]); // the head, into `next`
  assert.deepEqual(ahead(MOVING, 1, 0.5), [5.5, 5]); // ...taking the head's cell
  assert.deepEqual(ahead(MOVING, 2, 0.5), [4.5, 5]);
});

test("the ends of the slide are the cells the server sent, exactly", () => {
  // Position-continuous: alpha reaches 1 precisely as the next state lands, and
  // the cell it lands on is the one we were sliding towards. Consecutive slides
  // join up instead of stepping.
  assert.deepEqual(ahead(MOVING, 0, 0), [6, 5]);
  assert.deepEqual(ahead(MOVING, 0, 1), [7, 5]); // == the next state's cells[0]
  assert.deepEqual(ahead(MOVING, 1, 1), [6, 5]);
});

test("a snake about to eat does not drag its tail along", () => {
  // Growing keeps the tail: the server does not pop it. Slide it anyway and the
  // snake is drawn a cell short until the state lands and puts it back -- a tail
  // that flickers once per apple, every apple.
  const eating = stateAt(6, { grows: true });
  const tail = eating.cells.length - 1;

  assert.deepEqual(ahead(eating, tail, 0.5), eating.cells[tail], "the tail holds");
  assert.deepEqual(ahead(eating, 0, 0.5), [6.5, 5], "...but the head still slides");
});

test("a snake whose next move kills it stops, instead of sliding into the wall", () => {
  // `next` is null: the engine will not move it, because a snake dies WITHOUT
  // moving. Sliding it in anyway and yanking it back out when the state lands is
  // the sort of thing that looks like a bug even when the game got it right.
  const dying = stateAt(6, { doomed: true });

  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(ahead(dying, index, 0.5), dying.cells[index]);
  }
});

test("a dead snake is drawn where it fell", () => {
  // It died without moving, so its body still reads as a perfectly good path.
  // Walking it in either direction would drag the corpse off the cell it died on.
  const dead = stateAt(6, { alive: false, doomed: true });

  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(ahead(dead, index, 0.5), dead.cells[index]);
  }
});

// -- at(): walking the body BACKWARDS, to catch up on a state that never came --

test("a segment walks THROUGH the corner when a state went missing", () => {
  // THE CORNER-CUT. If a state never arrived, a segment has two cells to cover in
  // one slide. Lerping straight from where it was to where it is would draw a
  // DIAGONAL when the snake turned in between -- and a snake on a diagonal cuts
  // through the corner of a wall, or through its own neck. It must walk the path.
  //
  // The snake went east, then turned north. Two ticks of travel, one slide.
  const after = { cells: [[4, 3], [4, 4], [3, 4], [2, 4]], alive: true };
  //                       now     1 ago    2 ago   3 ago

  // Half way is exactly the corner cell -- NOT the diagonal midpoint of [3,4] and
  // [4,3], which would be [3.5, 3.5] and is inside the corner.
  assert.deepEqual(at(after, 0, 0.5, 2), [4, 4], "half way is the corner itself");
  assert.deepEqual(at(after, 0, 0.25, 2), [3.5, 4]); // half way along the first leg
  assert.deepEqual(at(after, 0, 0.75, 2), [4, 3.5]); // ...and the second

  // ...and at no point is it ever off the grid lines.
  for (let a = 0; a <= 1; a += 0.05) {
    const [x, y] = at(after, 0, a, 2);
    assert.ok(
      Number.isInteger(x) || Number.isInteger(y),
      `cut the corner at alpha=${a}: drew [${x}, ${y}]`,
    );
  }
});

test("a snake that just ate does not stretch its new tail across the board", () => {
  // Growing keeps the tail, so the snake is one cell longer and the LAST segment
  // has no history behind it. Sliding it in from nowhere would smear it across
  // the map. It must snap.
  const grown = { cells: [[6, 5], [5, 5], [4, 5]], alive: true };

  assert.deepEqual(at(grown, 2, 0.5), [4, 5], "the new tail must not move");
  assert.deepEqual(at(grown, 0, 0.5), [5.5, 5], "...but the head still slides");
});

// -- the timeline, under a connection that misbehaves ------------------------

/** Feed a stream of arrivals, sample the drawn head every frame, return speeds. */
function play({ jitter = () => 0, drop = [], ticks = 40 } = {}) {
  const clock = timeline(HZ);
  const FRAME = 1000 / 60;
  const samples = [];

  let now = 0;
  let next = 0;

  while (now < ticks * TICK) {
    while (next < ticks && next * TICK + jitter(next) <= now) {
      if (!drop.includes(next)) {
        clock.accept(stateAt(next), next, next * TICK + jitter(next));
      }
      next += 1;
    }
    const drawn = head(clock, now);
    if (drawn !== null) samples.push(drawn);
    now += FRAME;
  }

  const speeds = [];
  for (let i = 1; i < samples.length; i += 1) {
    speeds.push(Math.abs(samples[i] - samples[i - 1]));
  }
  const nominal = FRAME / TICK; // cells per frame at the correct speed
  return {
    worst: Math.max(...speeds) / nominal,
    jumps: speeds.filter((s) => s > nominal * 2).length,
    clock,
  };
}

test("a clean stream is drawn at exactly one cell per tick, with no jumps", () => {
  const { worst, jumps } = play();
  assert.equal(jumps, 0);
  assert.ok(worst <= 1.05, `worst frame was ${worst.toFixed(2)}x normal speed`);
});

test("wifi jitter costs exactly the jitter, and not a fixed slice of a tick", () => {
  // Arrival times wobbling by +-20ms used to wobble the snake with them, because
  // the slide was anchored to when the packet landed: nine visible jumps in
  // twenty ticks, and not an apple in sight. The answer was half a tick of slack,
  // bought up front, against jitter that had not been measured.
  //
  // Half a tick is not an amount of jitter. It is not an amount of anything --
  // it is 62ms at 8 Hz and 83ms at 6, for a wobble that did not change by a
  // millisecond when the snake slowed down. So trail real time by what the line
  // is ACTUALLY costing: the wobble here spans 40ms, and 40ms is the bill.
  const wobble = [-20, 12, -6, 18, 3, -15, 9, -11, 20, -3]; // 40ms, peak to peak
  const { worst, jumps, clock } = play({ jitter: (k) => wobble[k % wobble.length] });

  assert.equal(jumps, 0, "jitter must not reach the screen");
  assert.ok(worst <= 1.1, `worst frame was ${worst.toFixed(2)}x normal speed`);

  const cost = clock.debug().delayTicks * TICK;
  assert.ok(cost <= 45, `paid ${cost.toFixed(0)}ms against 40ms of jitter`);
  assert.ok(
    cost < 0.5 * TICK,
    `${cost.toFixed(0)}ms is no better than the half-tick it replaces`,
  );
});

test("a dropped state is glided across, not teleported over", () => {
  // lobby.stream() drops a frame at a socket still busy with the last one -- on
  // purpose -- so this is not hypothetical. It is also the ONE thing that still
  // costs delay: a dropped state takes the next move with it, so once the move we
  // knew about is finished there is nothing left to draw forwards into. We catch
  // up backwards down the body instead, which is what at() is for.
  const { worst, jumps } = play({ drop: [10, 25] });

  assert.equal(jumps, 0, "a dropped state must not teleport the snake");
  assert.ok(worst <= 1.6, `worst frame was ${worst.toFixed(2)}x normal speed`);
});

test("a bad connection buys itself some buffer, and gives it back afterwards", () => {
  const clock = timeline(HZ);
  for (let k = 0; k < 6; k += 1) clock.accept(stateAt(k), k, k * TICK);
  assert.equal(clock.debug().delayTicks, 0, "a clean line pays nothing");

  clock.accept(stateAt(7), 7, 7 * TICK); // 6 never arrived
  const rattled = clock.debug().delayTicks;
  assert.ok(rattled > 0, "a dropped state must widen the buffer");

  for (let k = 8; k < 400; k += 1) clock.accept(stateAt(k), k, k * TICK);
  assert.ok(
    clock.debug().delayTicks < rattled,
    "and a long calm spell must give the latency back",
  );
});

test("a storm does not leave the game permanently a step further behind", () => {
  // The failure a hold-and-resume buffer invites: every hold pushes the render
  // clock further behind the stream, and if it never catches back up the lag
  // RATCHETS -- the game gets quietly laggier for the rest of the session, for no
  // reason the player can see. This clock derives the render point from absolute
  // time, so it converges on its own the moment the delay decays. Either way it
  // has to be proven.
  const clock = timeline(HZ);
  let tick = 0;
  const send = (arriving) => {
    clock.accept(stateAt(tick), tick, arriving);
    tick += 1;
  };

  for (; tick < 20; ) send(tick * TICK); // calm

  for (let i = 0; i < 5; i += 1) {
    tick += 1; // a state goes missing
    send(tick * TICK + 60); // ...and the next one limps in late
  }
  assert.ok(clock.debug().delayTicks > 0, "the storm must widen the buffer");

  for (; tick < 900; ) send(tick * TICK); // a long calm spell afterwards

  assert.equal(clock.debug().delayTicks, 0, "the buffer never gave the latency back");

  // ...and the snake is back to being drawn exactly where the server has it.
  const now = tick * TICK;
  assert.ok(
    Math.abs(head(clock, now) - now / TICK) < 0.001,
    `the render clock ratcheted: drew ${head(clock, now)}, server at ${now / TICK}`,
  );
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
