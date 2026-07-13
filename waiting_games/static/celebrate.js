// What winning and losing feel like.
//
// Fires ONCE, on the transition into game-over -- see app.js. Not on the state of
// being over: a player who reloads the results page should not be showered in
// confetti for a game they finished ten minutes ago.

import { fanfare, shrug, soundOn, trombone } from "./sound.js";

const PIECES = 150;
const GRAVITY = 900; // px/s/s
const LIFE = 3000; // ms, after which the canvas goes whatever happens

const COLOURS = ["#4c8bf5", "#3c8552", "#e8b93a", "#c0524e", "#8a63d2", "#39a4b8"];

// Motion is the part that hurts people. Sound is not, and it is separately
// mutable, so a reduced-motion player still gets their trombone.
function stillness() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function celebrate(outcome, board) {
  if (outcome === "win") {
    if (!stillness()) confetti();
    if (soundOn()) fanfare();
  } else if (outcome === "lose") {
    if (!stillness()) shake(board);
    if (soundOn()) trombone();
  } else if (outcome === "draw") {
    if (soundOn()) shrug();
  }
  // "none" -- a spectator. They did not win and they did not lose, and a stranger's
  // game ending is not an event that should make their phone play a trumpet.
}

function shake(board) {
  if (!board) return;
  board.classList.remove("shaken"); // so a second loss re-triggers it
  void board.offsetWidth; // force a reflow, or the class re-add is a no-op
  board.classList.add("shaken");
  board.addEventListener(
    "animationend",
    () => board.classList.remove("shaken"),
    { once: true },
  );
}

function confetti() {
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  document.body.append(canvas);

  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  let width = 0;
  let height = 0;

  function size() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  size();
  window.addEventListener("resize", size);

  // Spawned in a TIGHT band just above the top edge, so they arrive as one sheet.
  // Spreading them over half a screen-height instead (the obvious way to write
  // this) drizzles them past a few at a time: at any given moment most of the
  // confetti is still off-screen, and what you see is drab rain.
  const pieces = Array.from({ length: PIECES }, () => ({
    x: Math.random() * width,
    y: -20 - Math.random() * height * 0.12,
    vx: (Math.random() - 0.5) * 300,
    vy: 200 + Math.random() * 220,
    size: 5 + Math.random() * 7,
    spin: (Math.random() - 0.5) * 12,
    angle: Math.random() * Math.PI * 2,
    colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
  }));

  let frame = null;
  let last = performance.now();
  const born = last;

  function done() {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", size);
    canvas.remove();
  }

  function paint(now) {
    // Seconds, and clamped: a background tab hands back a dt of many seconds, and
    // integrating that in one step teleports every piece into the floor.
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    context.clearRect(0, 0, width, height);
    let living = 0;

    for (const piece of pieces) {
      piece.vy += GRAVITY * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.angle += piece.spin * dt;

      if (piece.y > height + piece.size) continue; // landed, and gone
      living += 1;

      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.angle);
      context.fillStyle = piece.colour;
      // Squashed on one axis by the spin, which is what sells it as paper rather
      // than as a falling square.
      context.fillRect(
        -piece.size / 2,
        -piece.size / 4,
        piece.size,
        piece.size / 2,
      );
      context.restore();
    }

    // Whichever comes first: the last piece landing, or the deadline. The
    // deadline is the one that matters -- a piece thrown sideways hard enough can
    // hang around off-screen, and without it the canvas would live forever.
    if (living === 0 || now - born > LIFE) return done();
    frame = requestAnimationFrame(paint);
  }

  frame = requestAnimationFrame(paint);
}
