// The readout is a measuring instrument, and an instrument that lies is worse
// than no instrument at all: it does not leave you ignorant, it leaves you
// confidently wrong. `key -> turn` in particular is the number somebody will use
// to decide whether the game is fixed, so it had better be the truth.

import assert from "node:assert/strict";
import { test } from "node:test";

// A DOM small enough for _debug.js, and a clock we control -- the readout's
// stopwatch runs on performance.now(), so a test that cannot move it cannot test
// the one thing most worth testing.
let panel = null;
let clock = 0;

globalThis.performance = { now: () => clock };
globalThis.document = {
  createElement() {
    panel = { className: "", textContent: "", append() {}, remove() {} };
    return panel;
  },
};

const root = { append() {} };
const debugging = (on) => {
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

  const shown = panel.textContent;
  const measured = Number(/key -> turn\s+(\d+)ms/.exec(shown)[1]);
  const expected = 7 * FRAME; // the 6 straight frames, plus the one that turned

  assert.ok(
    Math.abs(measured - expected) < FRAME,
    `reported ${measured}ms for a turn that took ${expected.toFixed(0)}ms:\n${shown}`,
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

  const measured = Number(/key -> turn\s+(\d+)ms/.exec(panel.textContent)[1]);
  assert.ok(
    measured >= 10 * FRAME,
    `the second press reset the clock: reported ${measured}ms, but the player has ` +
      `been waiting since ${(at - first).toFixed(0)}ms ago`,
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

  const worst = Number(/worst frame (\d+)ms/.exec(panel.textContent)[1]);
  assert.ok(worst >= 100, `a 100ms stall was reported as ${worst}ms`);
});
