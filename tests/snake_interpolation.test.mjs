// The snake slides between ticks instead of teleporting a whole cell eight times
// a second. This is the arithmetic that does it.
//
// Worth testing for the same reason _geometry.js is: it is a few lines of index
// juggling that are either exactly right or subtly, invisibly wrong, and "the
// snake looks a bit odd" is not a bug report anyone can act on.

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_SPAN_MS, at, spanFor } from "../waiting_games/static/games/_interpolate.js";

// A snake moving right: the head pushes onto the front, the tail falls off.
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

// -- the span ---------------------------------------------------------------
//
// This is the arithmetic that was making the snake jank, so it gets the most
// tests. The gap between two arrivals is NOT the span: it carries the server's
// jitter and the network's, and sliding over a span that is even slightly too
// long leaves the snake short of the cell when the next state lands -- so it
// jumps the rest. Round the measurement to a whole number of ticks instead.

test("a jittery arrival still slides over exactly one tick", () => {
  // The bug, in one assertion. The server ticks every 125ms; the arrival was
  // 12ms late because it carried the tick that respawned an apple. The old code
  // took the 137 at face value, and the snake jumped the difference.
  assert.equal(spanFor(137, 8), 125);
  assert.equal(spanFor(113, 8), 125);
  assert.equal(spanFor(125, 8), 125);
});

test("a state that never arrived is two ticks of travel, not one", () => {
  // The server drops a frame at a socket that is still busy with the last one --
  // deliberately, see lobby.stream(). The snake has then moved two cells, and it
  // must GLIDE them over two ticks rather than snap them in one.
  assert.equal(spanFor(250, 8), 250);
  assert.equal(spanFor(261, 8), 250); // ...jitter and all
  assert.equal(spanFor(375, 8), 375);
});

test("the span is never less than a single tick", () => {
  assert.equal(spanFor(0, 8), 125);
  assert.equal(spanFor(-50, 8), 125);
  assert.equal(spanFor(3, 8), 125);
});

test("a faster game is not stretched to a slow game's floor", () => {
  // There used to be a flat 50ms floor under the span. Pong ticks at 30 Hz, so
  // its tick is 33.3ms, and that floor would have quietly slowed every slide by
  // half -- the sort of wrong that looks fine until you measure it.
  assert.ok(Math.abs(spanFor(33, 30) - 1000 / 30) < 0.01);
  assert.ok(Math.abs(spanFor(0, 60) - 1000 / 60) < 0.01);
});

test("a backgrounded tab snaps rather than crawling for eight seconds", () => {
  assert.equal(spanFor(8000, 8), MAX_SPAN_MS);
});

test("with no tick rate on the wire, the span still has a sane duration", () => {
  assert.equal(spanFor(0, undefined), 125);
  assert.equal(spanFor(130, null), 125);
});
