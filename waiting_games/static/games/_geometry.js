// Pong's board rotation, and what it does to the controls.
//
// This is deliberately free of any DOM, so it can be unit-tested in plain node --
// see tests/pong_geometry.test.mjs. The bug it guards against was invisible on
// inspection and shipped: two of the four walls had their steering inverted, so
// in an ordinary two-player game whoever joined second played with their controls
// backwards.

// How far to turn the board so that `wall` ends up at the bottom, where the
// player's hands are.
export const ROTATION = {
  bottom: 0,
  left: -Math.PI / 2,
  top: Math.PI,
  right: Math.PI / 2,
};

/**
 * +1 if a growing `position` moves the paddle rightwards on THIS player's screen,
 * -1 if the rotation flips it.
 *
 * The server's `paddle: +1` means "along your wall" in world terms. Rotating the
 * board to put that wall at the bottom can reverse which way that looks, and it
 * does for `right` and `top`. Sending +1 when the player asked for right would
 * then move their paddle left.
 *
 * Derived from ROTATION rather than written down next to it: a second table could
 * silently disagree with the first, and this cannot.
 */
export function screenSign(wall) {
  const turn = ROTATION[wall] ?? 0;

  // The direction the paddle travels as `position` grows, in world coordinates:
  // down the side walls, across the top and bottom ones.
  const [dx, dy] = wall === "left" || wall === "right" ? [0, 1] : [1, 0];

  // ...rotated onto the screen. Only the x-component matters: once the player's
  // wall is at the bottom, their paddle is drawn horizontally.
  const screenX = dx * Math.cos(turn) - dy * Math.sin(turn);
  return screenX >= 0 ? 1 : -1;
}

/**
 * Where a paddle at `position` is drawn, horizontally, in a unit-square board
 * that has been rotated to put `wall` at the bottom. Used by the test to check
 * that the sign above actually produces the movement a player asked for.
 */
export function paddleScreenX(wall, position) {
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
  return 0.5 + dx * Math.cos(turn) - dy * Math.sin(turn);
}
