// Sliding a snake between two states the server has already agreed on.
//
// DOM-free, so it can be unit-tested -- the same reason _geometry.js exists.
// Pong's rotation maths was silently wrong for two of its four walls, and it
// stayed wrong because nothing could test it without a browser. This is the same
// shape of code: a small piece of arithmetic that is either right or subtly,
// invisibly wrong.

// A tick that claims to have taken less than this is a burst, and one that claims
// more is a stall. Sliding literally over either would look worse than not
// sliding at all.
export const MIN_SPAN_MS = 50;
export const MAX_SPAN_MS = 500;

export function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

// Where segment `index` should be drawn, part-way between the last two states.
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
