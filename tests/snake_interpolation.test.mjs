// The snake slides between ticks instead of teleporting a whole cell eight times
// a second. This is the arithmetic that does it.
//
// Worth testing for the same reason _geometry.js is: it is a few lines of index
// juggling that are either exactly right or subtly, invisibly wrong, and "the
// snake looks a bit odd" is not a bug report anyone can act on.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_SPAN_MS,
  MIN_SPAN_MS,
  at,
  clamp,
} from "../waiting_games/static/games/_interpolate.js";

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

test("a stalled or bursting tick is clamped rather than animated literally", () => {
  // A backgrounded tab hands back a gap of many seconds. Sliding one cell over
  // eight of them is not smoothness, it is paralysis.
  assert.equal(clamp(8000, MIN_SPAN_MS, MAX_SPAN_MS), MAX_SPAN_MS);
  assert.equal(clamp(0, MIN_SPAN_MS, MAX_SPAN_MS), MIN_SPAN_MS);
  assert.equal(clamp(125, MIN_SPAN_MS, MAX_SPAN_MS), 125);
});
