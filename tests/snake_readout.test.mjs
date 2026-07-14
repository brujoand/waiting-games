// The readout is a measuring instrument, and an instrument that lies is worse
// than no instrument at all: it does not leave you ignorant, it leaves you
// confidently wrong. `key -> turn` in particular is the number somebody will use
// to decide whether the game is fixed, so it had better be the truth.

import assert from "node:assert/strict";
import { test } from "node:test";

// A DOM small enough for _debug.js, and a clock we control -- the readout's
// stopwatch runs on performance.now(), so a test that cannot move it cannot test
// the one thing most worth testing.
let made = [];
let clock = 0;

const element = () => ({
  className: "",
  type: "",
  textContent: "",
  style: {},
  append() {},
  remove() {},
  setAttribute() {},
  addEventListener() {},
  select() {},
});

globalThis.performance = { now: () => clock };
globalThis.document = {
  createElement() {
    const node = element();
    made.push(node);
    return node;
  },
};

// The readout writes its live figures into the <pre>, which is the second thing it
// makes: the box, then the panel, then the button.
const shown = () => made[1].textContent;
const root = { append() {} };
const debugging = (on) => {
  made = [];
  globalThis.location = { search: on ? "?debug" : "" };
};

const { readout } = await import("../waiting_games/static/games/_debug.js");

const FRAME = 1000 / 60;
const TICK = 1000 / 6;

/** Paint `frames` of a head travelling one cell per tick along `axis`. */
function slide(meter, from, frames, axis, at) {
  let head = [...from];
  for (let i = 0; i < frames; i += 1) {
    at += FRAME;
    clock = at;
    head = axis === "x" ? [head[0] + FRAME / TICK, head[1]] : [head[0], head[1] + FRAME / TICK];
    meter.frame({
      now: at,
      head,
      path: "live",
      delayMs: 0,
      tickMs: TICK,
      dropped: 0,
      stateAge: 20,
    });
  }
  return { head, at };
}

test("it is off unless the page asked for it", () => {
  debugging(false);
  assert.equal(readout(root), null, "a readout nobody asked for is a readout in the way");
});

test("key -> turn is the time from the keypress to the head changing axis", () => {
  debugging(true);
  const meter = readout(root);

  // Running right for a while, so the readout knows which way that is.
  let { head, at } = slide(meter, [5, 5], 20, "x", 0);

  // The player presses. Then the snake carries on rightwards for 6 more frames --
  // it cannot turn in the middle of a cell -- and only then starts heading down.
  clock = at;
  meter.pressed();
  const pressedAt = at;

  ({ head, at } = slide(meter, head, 6, "x", at));
  ({ head, at } = slide(meter, head, 20, "y", at));

  const text = shown();
  const measured = Number(/key -> turn\s+(\d+)ms/.exec(text)[1]);
  const expected = 7 * FRAME; // the 6 straight frames, plus the one that turned

  assert.ok(
    Math.abs(measured - expected) < FRAME,
    `reported ${measured}ms for a turn that took ${expected.toFixed(0)}ms:\n${text}`,
  );
});

test("hammering the keys does not restart the stopwatch", () => {
  // Otherwise the number reported is the latency of the LAST press before the
  // turn -- which is always tiny, and always flattering, and always a lie.
  debugging(true);
  const meter = readout(root);

  let { head, at } = slide(meter, [5, 5], 20, "x", 0);

  clock = at;
  meter.pressed(); // the press that will actually be answered
  const first = at;

  ({ head, at } = slide(meter, head, 5, "x", at));
  clock = at;
  meter.pressed(); // ...and an impatient one, a moment later
  ({ head, at } = slide(meter, head, 5, "x", at));
  ({ head, at } = slide(meter, head, 20, "y", at));

  const measured = Number(/key -> turn\s+(\d+)ms/.exec(shown())[1]);
  assert.ok(
    measured >= 10 * FRAME,
    `the second press reset the clock: reported ${measured}ms, but the player has ` +
      `been waiting since ${(at - first).toFixed(0)}ms ago`,
  );
});

test("a press nothing answered is COUNTED, not averaged into the latency", () => {
  // THE BUG THIS READOUT SHIPPED WITH, and it made the game look half a tick worse
  // than it is. A press the server threw away -- you tried to reverse into your own
  // neck -- never produces a turn, so the stopwatch ran on until the NEXT real turn
  // and reported that whole wait as if it were this press's latency. One poisoned
  // sample in an eight-sample mean is all it takes: seven honest 100ms turns and one
  // 600ms phantom average out to 162ms, and 162ms is a whole tick, and a whole tick
  // is exactly the bug we had just spent a day removing. The instrument accused the
  // code of the crime it had itself committed.
  //
  // A press with no answer has no latency. It has to be counted, not averaged.
  debugging(true);
  const meter = readout(root);

  let { head, at } = slide(meter, [5, 5], 20, "x", 0);

  // An honest turn: pressed, answered six frames later.
  clock = at;
  meter.pressed();
  ({ head, at } = slide(meter, head, 6, "x", at));
  ({ head, at } = slide(meter, head, 10, "y", at));

  // Now one the server threw away. No turn EVER comes: the snake carries on down.
  clock = at;
  meter.pressed();
  ({ head, at } = slide(meter, head, 60, "y", at)); // a full second of no answer

  const text = shown();
  assert.match(text, /ignored 1/, `the dropped press was not counted:\n${text}`);

  const mean = Number(/mean (\d+)ms/.exec(text)[1]);
  assert.ok(
    mean < 3 * FRAME + 8 * FRAME,
    `the phantom poisoned the mean: ${mean}ms, off one honest ~117ms turn:\n${text}`,
  );
});

test("a stalled paint loop shows up as the worst frame, not as an average", () => {
  // 60fps with one 100ms hole in it is not 60fps, and the hole is the thing you
  // saw. An average would hide it, which is exactly how "it feels choppy" ends up
  // being argued about instead of measured.
  debugging(true);
  const meter = readout(root);

  let { head, at } = slide(meter, [5, 5], 20, "x", 0);

  at += 100; // the tab hitched
  clock = at;
  head = [head[0] + 100 / TICK, head[1]];
  meter.frame({
    now: at,
    head,
    path: "live",
    delayMs: 0,
    tickMs: TICK,
    dropped: 0,
    stateAge: 20,
  });
  slide(meter, head, 12, "x", at);

  const worst = Number(/worst frame (\d+)ms/.exec(shown())[1]);
  assert.ok(worst >= 100, `a 100ms stall was reported as ${worst}ms`);
});
