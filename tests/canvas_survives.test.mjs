// A renderer that throws must not take the game with it.
//
// It used to. The loop was:
//
//     context.clearRect(...);
//     paint(context, side);                  // throws
//     frame = requestAnimationFrame(loop);   // never runs
//
// One exception anywhere in any renderer and the next frame was never scheduled.
// The board froze for ever -- blank if the throw came before the drawing, frozen
// mid-game if after -- and said nothing at all. On a phone there is no console to
// open, so the game was simply broken, with no way on earth to find out why.
//
// That is not a rendering bug, it is a bug in how rendering FAILS, and it is worth
// its own test: the loop must survive, and it must say so.

import assert from "node:assert/strict";
import { test } from "node:test";

let queued = [];
const made = [];

const element = () => {
  const node = {
    className: "",
    textContent: "",
    style: {},
    clientWidth: 480,
    children: [],
    getContext: () => ({
      setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {},
      arc() {}, fill() {}, strokeRect() {},
    }),
    append(...kids) { node.children.push(...kids); },
    replaceChildren(...kids) { node.children = kids; },
    addEventListener() {}, removeEventListener() {}, remove() {},
  };
  made.push(node);
  return node;
};

globalThis.document = { createElement: element };
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.requestAnimationFrame = (fn) => queued.push(fn);
globalThis.cancelAnimationFrame = () => {};

const { canvas } = await import("../waiting_games/static/games/_canvas.js");

const run = (frames) => {
  for (let i = 0; i < frames; i += 1) {
    const due = queued;
    queued = [];
    for (const fn of due) fn();
  }
};

test("a renderer that throws does not stop the paint loop for ever", () => {
  queued = [];
  let painted = 0;
  const root = element();

  canvas(root, () => {
    painted += 1;
    if (painted <= 3) throw new Error("the seed is not a number");
  });

  run(10);

  assert.ok(painted >= 9, `the loop died after ${painted} frames -- it must not`);
});

test("...and it says what went wrong, where a phone can read it", () => {
  // The console is not available on the device this actually broke on. If the only
  // report is a console.error, the bug is invisible to the person holding it.
  queued = [];
  const root = element();

  canvas(root, () => {
    throw new Error("cells is undefined");
  });
  run(3);

  const complaint = root.children.find((child) => child.className.includes("broke"));
  assert.ok(complaint, "the renderer threw and the page said nothing");
  assert.match(complaint.textContent, /cells is undefined/);
});

test("it complains once, not sixty times a second", () => {
  queued = [];
  const root = element();

  canvas(root, () => {
    throw new Error("boom");
  });
  run(30);

  const complaints = root.children.filter((child) => child.className.includes("broke"));
  assert.equal(complaints.length, 1, "a throw every frame must not become a wall of text");
});
