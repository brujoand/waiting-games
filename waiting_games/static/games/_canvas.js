// Shared plumbing for the real-time games: a canvas, and the ways to steer it.
//
// The steering half is not only theirs -- 2048 is a dom game and takes the same
// four directions, so it takes the same keys() and swipe(). It just skips
// onChange(), which is the piece that is specific to a game with a heading.
//
// A canvas game must NOT redraw from the state push. The server ticks at 6-30 Hz;
// the browser paints at 60. Painting from a requestAnimationFrame loop that reads
// the latest frame decouples the two, so a dropped or late frame is a smooth
// stall rather than a stutter.
//
// Every input helper here sends INTENT and sends it only when it CHANGES. A phone
// is the reason that rule matters: a finger held on the screen must be one
// message, not one per frame.

export function canvas(root, paint) {
  const element = document.createElement("canvas");
  element.className = "rt-canvas";
  root.replaceChildren(element);

  const context = element.getContext("2d");
  let frame = null;

  function size() {
    // Draw at device resolution so the board is not soft on a retina screen.
    const ratio = window.devicePixelRatio || 1;
    const side = element.clientWidth;
    element.width = side * ratio;
    element.height = side * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return side;
  }

  let side = size();
  const resize = () => {
    side = size();
  };
  window.addEventListener("resize", resize);

  // The loop must not be able to die. It used to:
  //
  //     context.clearRect(...);
  //     paint(context, side);            // <- throws
  //     frame = requestAnimationFrame(loop);   // <- never runs
  //
  // One exception anywhere in a renderer and the next frame is never scheduled.
  // The game freezes for ever -- BLANK if it threw before drawing, FROZEN mid-board
  // if after -- and says nothing at all. On a phone, where there is no console to
  // open, that is a game that is simply broken with no way to find out why. It cost
  // a day.
  //
  // So: reschedule in a `finally`, which cannot be skipped, and SAY SO on the page
  // itself. A renderer that throws every frame will now stutter and complain rather
  // than die in silence, and the complaint is legible from the sofa.
  let broke = null;

  function fail(error) {
    if (broke) return; // once. A throw every frame must not become a wall of text.
    broke = document.createElement("p");
    broke.className = "hint broke";
    broke.textContent = `renderer: ${error?.message ?? error}`;
    root.append(broke);
    // ...and the whole thing where a console exists.
    console.error("renderer threw; the board will keep painting", error);
  }

  function loop() {
    try {
      context.clearRect(0, 0, side, side);
      paint(context, side);
    } catch (error) {
      fail(error);
    } finally {
      frame = requestAnimationFrame(loop);
    }
  }
  frame = requestAnimationFrame(loop);

  return {
    // Touch handlers bind to this, so they can measure the board they are on.
    element,

    // Without this teardown the loop keeps painting into a detached canvas and
    // the resize listener stacks up on every trip back to the lobby.
    destroy() {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      broke?.remove();
    },
  };
}

// How to steer. Mounted ONCE, under the board, and never touched again.
//
// This used to be tacked onto the end of the status line, which a real-time game
// rewrites 6-30 times a second. A sentence that never changes, reprinted next to
// numbers that do, is what made those screens feel noisy: the eye keeps being
// pulled back to re-read something it already knows. Say it once, and leave the
// live line to carry only what is actually live.
//
// Call it AFTER canvas(), which replaces the root's children.
export function hint(root, text) {
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = text;
  root.append(note);
  return note;
}

// Send an intent only when it CHANGES.
//
// keydown autorepeat fires ~30 times a second, and a finger dragged across the
// screen fires a pointermove per frame. Without a dedupe, either would be tens of
// messages a second, per player.
//
// ONE deduper per game, shared by every input it accepts -- see onChange(). If
// the keyboard and the touch handler each kept their own idea of the last thing
// sent, they would disagree the moment a player used both, and the disagreement
// would show up as a paddle that ignores you.
//
// `onRelease` is for a game where letting go MEANS something: Pong's paddle
// stops. Snake keeps its heading, so it passes nothing.
//
// It reports whether the intent actually WENT. Nearly every caller ignores that,
// and should. The ?debug readout does not: it times a keypress against the turn
// that answers it, and a press swallowed here has no answer coming -- so timing
// one charges the game for input it was never sent, and the figure it reports is
// really the wait for somebody else's press.
export function onChange(send) {
  let last = null;

  return (intent) => {
    const encoded = JSON.stringify(intent);
    if (encoded === last) return false; // the server already knows
    last = encoded;
    send(intent);
    return true;
  };
}

export function keys(bindings, intend, onRelease = null) {
  const down = []; // the bound keys currently held, most recent last

  const press = (event) => {
    const intent = bindings[event.key];
    if (intent === undefined) return;
    // Even on a repeat: the arrow keys still scroll the page otherwise.
    event.preventDefault();

    // Autorepeat is the keyboard describing one press, not the player making a
    // second one. A real-time game already swallows the difference in onChange(),
    // but 2048 acts on every message it sends -- and a held key there means a
    // board sliding thirty times a second.
    if (event.repeat) return;

    if (!down.includes(event.key)) down.push(event.key);
    intend(intent);
  };

  const release = (event) => {
    if (bindings[event.key] === undefined) return;
    event.preventDefault();

    const index = down.indexOf(event.key);
    if (index !== -1) down.splice(index, 1);
    if (onRelease === null) return; // Snake keeps its heading; only Pong stops

    // Fall back to whatever is STILL held. Sending the stop unconditionally
    // would freeze the paddle when you let go of one of two held keys -- hold
    // left, tap right, release right, and left is still down.
    const held = down[down.length - 1];
    intend(held === undefined ? onRelease : bindings[held]);
  };

  window.addEventListener("keydown", press);
  window.addEventListener("keyup", release);

  return () => {
    window.removeEventListener("keydown", press);
    window.removeEventListener("keyup", release);
  };
}

export const COLOURS = [
  "#3b6fd4",
  "#d9534f",
  "#3c8552",
  "#f0c419",
  "#8e5bd0",
  "#48b8c4",
];

// -- touch ------------------------------------------------------------------
//
// Pointer events rather than touch events, so one code path covers a finger, a
// stylus and a mouse. The canvas sets `touch-action: none` in CSS, which is what
// stops a swipe scrolling the page out from under the game.

const SWIPE_THRESHOLD = 24; // px before a drag counts as a swipe, not a tap

/**
 * Swipe to steer, for a game with four directions.
 *
 * The origin resets after every swipe, so a long continuous drag round a corner
 * sends `left` then `up` rather than one direction and a lot of silence.
 */
export function swipe(element, intend, directions) {
  let origin = null;

  const start = (event) => {
    // Tell the browser this gesture is ours. touch-action:none should already
    // have done it, but a swipe that silently becomes a page scroll is exactly
    // the failure this had in the field, and saying it twice is free.
    event.preventDefault();
    origin = { x: event.clientX, y: event.clientY };
  };

  const move = (event) => {
    if (!origin) return;

    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return;

    // The dominant axis wins, so a sloppy diagonal still goes somewhere sensible
    // rather than nowhere.
    const intent =
      Math.abs(dx) > Math.abs(dy)
        ? directions[dx > 0 ? "right" : "left"]
        : directions[dy > 0 ? "down" : "up"];

    intend(intent);
    origin = { x: event.clientX, y: event.clientY }; // ...ready for the next one
  };

  const end = () => {
    origin = null;
  };

  // move/up on the WINDOW, not the element.
  //
  // The first version listened on the canvas and called setPointerCapture to keep
  // receiving the events. On a real phone that silently ate EVERY swipe -- the
  // logic was right, the unit tests passed, touch-action was set, and the game was
  // simply unsteerable. Listening on the window is what fixed it.
  //
  // So: do not put the capture back. A finger that strays off the board mid-swipe
  // still steers, and there is nothing exotic left in the path to misbehave.
  element.addEventListener("pointerdown", start);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);

  return () => {
    element.removeEventListener("pointerdown", start);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
  };
}

/**
 * Hold the left or right half of the board to steer along one axis; let go to
 * stop.
 *
 * This maps exactly onto the intent protocol -- one message when you press, one
 * when you let go -- so a phone costs the server no more than a keyboard does.
 * Dragging the paddle to a POSITION would have been the obvious thing and is the
 * wrong one: it is a message per frame, and a position is trivially cheatable in
 * a way an intent is not.
 */
export function halves(element, intend, { left, right, release }) {
  const held = new Set();

  const aim = (event) => {
    const box = element.getBoundingClientRect();
    return event.clientX < box.left + box.width / 2 ? left : right;
  };

  const press = (event) => {
    held.add(event.pointerId);
    element.setPointerCapture?.(event.pointerId);
    intend(aim(event));
  };

  const move = (event) => {
    // Slide a held finger across the middle and the paddle turns round, without
    // having to lift it.
    // Every pointermove calls this; onChange() is what stops that being a
    // message per frame.
    if (held.has(event.pointerId)) intend(aim(event));
  };

  const lift = (event) => {
    held.delete(event.pointerId);
    if (held.size === 0) intend(release);
  };

  element.addEventListener("pointerdown", press);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", lift);
  element.addEventListener("pointercancel", lift);

  return () => {
    element.removeEventListener("pointerdown", press);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", lift);
    element.removeEventListener("pointercancel", lift);
  };
}
