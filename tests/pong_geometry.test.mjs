// The one piece of Pong's client that is pure geometry, and the one that was
// silently wrong.
//
// Run with: node --test tests/

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ROTATION,
  paddleScreenX,
  screenSign,
} from "../waiting_games/static/games/_geometry.js";

const WALLS = ["left", "right", "top", "bottom"];

test("every wall is rotated to the bottom of the player's screen", () => {
  for (const wall of WALLS) {
    const y = paddleScreenY(wall, 0.5);
    assert.ok(y > 0.9, `${wall} wall should be drawn at the bottom, got y=${y}`);
  }
});

test("asking to go right moves the paddle right, on every wall", () => {
  // The bug: the server's `paddle: +1` means "along your wall" in world terms,
  // and the rotation reverses which way that looks for `right` and `top`. Two of
  // four players -- including the second player in an ordinary two-player game --
  // had their controls backwards.
  for (const wall of WALLS) {
    const drift = 1 * screenSign(wall); // the player asked for RIGHT

    const before = paddleScreenX(wall, 0.5);
    const after = paddleScreenX(wall, 0.5 + 0.1 * drift);

    assert.ok(
      after > before,
      `on the ${wall} wall, asking for right moved the paddle left`,
    );
  }
});

test("asking to go left moves the paddle left, on every wall", () => {
  for (const wall of WALLS) {
    const drift = -1 * screenSign(wall);

    const before = paddleScreenX(wall, 0.5);
    const after = paddleScreenX(wall, 0.5 + 0.1 * drift);

    assert.ok(
      after < before,
      `on the ${wall} wall, asking for left moved the paddle right`,
    );
  }
});

test("the sign is derived from the rotation, not hardcoded beside it", () => {
  // If someone re-tables ROTATION, the sign must follow. Flip a wall's rotation
  // by half a turn and its sign must flip with it -- a hand-written lookup would
  // not, and that is the whole class of bug being guarded here.
  const original = ROTATION.bottom;
  try {
    ROTATION.bottom = Math.PI;
    assert.equal(screenSign("bottom"), -1);
  } finally {
    ROTATION.bottom = original;
  }
  assert.equal(screenSign("bottom"), 1);
});

// Same transform the renderer uses, for the vertical axis.
function paddleScreenY(wall, position) {
  const turn = ROTATION[wall];
  const [x, y] =
    wall === "left"
      ? [0, position]
      : wall === "right"
        ? [1, position]
        : wall === "top"
          ? [position, 0]
          : [position, 1];

  const [dx, dy] = [x - 0.5, y - 0.5];
  return 0.5 + dx * Math.sin(turn) + dy * Math.cos(turn);
}
