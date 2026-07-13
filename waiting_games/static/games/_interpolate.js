// Sliding a snake between two states the server has already agreed on.
//
// DOM-free, so it can be unit-tested -- the same reason _geometry.js exists.
// Pong's rotation maths was silently wrong for two of its four walls, and it
// stayed wrong because nothing could test it without a browser. This is the same
// shape of code: a small piece of arithmetic that is either right or subtly,
// invisibly wrong.

// A backgrounded tab hands back a gap of many seconds. Sliding one cell over
// eight of them is not smoothness, it is paralysis: past this, snap.
export const MAX_SPAN_MS = 500;

// Only used when the server has not said how fast it ticks.
export const ASSUMED_TICK_MS = 125;

// How long to slide for.
//
// NOT the measured gap, which is what this used to be. The gap between two
// arrivals carries every hiccup between the server's tick loop and this line --
// scheduler jitter, a busy socket, wifi, a slow tick -- and a span even 10ms too
// long is a slide that has only gone 92% of the way to the next cell by the time
// the next state lands on time. The snake then JUMPS the last 8%. Measuring the
// span is therefore self-defeating: it turns a late tick into a stall AND a jump,
// and the jump is the exact thing the sliding exists to remove.
//
// The tick rate is known -- the server sends it -- so the honest span is a WHOLE
// NUMBER of ticks. Round the measurement to one. That keeps the property the
// measurement was there for (a state that never arrived means two ticks of
// travel, and the snake glides two cells rather than snapping them) and throws
// away the jitter that came with it. Being exactly right is also what makes the
// slide position-continuous: alpha reaches 1 precisely as the next state lands,
// so consecutive slides join up instead of stepping.
//
// There is deliberately no lower clamp. One tick IS the floor, and a fixed 50ms
// floor -- which is what used to be here -- would silently stretch every slide in
// any game ticking faster than 20 Hz. Pong ticks at 30.
export function spanFor(measured, tickHz) {
  const tick = tickHz ? 1000 / tickHz : ASSUMED_TICK_MS;
  const ticks = Math.max(1, Math.round(measured / tick));
  return Math.min(ticks * tick, MAX_SPAN_MS);
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
