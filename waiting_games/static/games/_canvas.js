// Shared plumbing for the real-time games.
//
// The point of both helpers is that a canvas game must NOT redraw from the state
// push. The server ticks at 8-30 Hz; the browser paints at 60. Painting from a
// requestAnimationFrame loop that reads the latest frame decouples the two, so a
// dropped or late frame is a smooth stall rather than a stutter.

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

  function loop() {
    context.clearRect(0, 0, side, side);
    paint(context, side);
    frame = requestAnimationFrame(loop);
  }
  frame = requestAnimationFrame(loop);

  // Without this teardown the loop keeps painting into a detached canvas and the
  // resize listener stacks up on every trip back to the lobby.
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
  };
}

// Send an intent only when it CHANGES.
//
// keydown autorepeat fires ~30 times a second, so without this guard a held
// arrow key would be thirty messages a second, per player. This dedupe is the
// real reason the server's rate limiter never fires for an honest client -- a
// key held for three seconds is one message, not ninety.
//
// `onRelease` is for a game where letting go MEANS something: Pong's paddle
// stops. Snake keeps its heading, so it passes nothing.
export function keys(bindings, send, onRelease = null) {
  let last = null;
  const down = []; // the bound keys currently held, most recent last

  const intend = (intent) => {
    const encoded = JSON.stringify(intent);
    if (encoded === last) return; // the server already knows
    last = encoded;
    send(intent);
  };

  const press = (event) => {
    const intent = bindings[event.key];
    if (intent === undefined) return;
    event.preventDefault();
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
