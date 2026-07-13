// The input layer, driven through a minimal fake DOM.
//
// The swipe shipped once and did not work on a real phone -- its logic was fine,
// so something in the browser ate the gesture. That is exactly the class of thing
// a unit test cannot see, which is why the on-screen buttons exist and why THEY
// are tested here: a button that sends on pointerdown has no moving parts to eat.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { halves, onChange, pad, swipe } from "../waiting_games/static/games/_canvas.js";

// -- the smallest DOM that these helpers actually touch ----------------------

function element(rect = { left: 0, width: 200 }) {
  const handlers = {};
  return {
    handlers,
    style: {},
    className: "",
    children: [],
    addEventListener: (type, fn) => (handlers[type] ??= []).push(fn),
    removeEventListener: (type, fn) => {
      handlers[type] = (handlers[type] ?? []).filter((h) => h !== fn);
    },
    append(...kids) {
      this.children.push(...kids);
    },
    remove() {},
    setAttribute() {},
    getBoundingClientRect: () => rect,
    fire(type, event = {}) {
      for (const fn of handlers[type] ?? []) {
        fn({ pointerId: 1, preventDefault() {}, ...event });
      }
    },
  };
}

beforeEach(() => {
  const window_ = element();
  globalThis.window = window_;
  globalThis.document = { createElement: () => element() };
});

const DIRECTIONS = {
  up: { dir: "up" },
  down: { dir: "down" },
  left: { dir: "left" },
  right: { dir: "right" },
};

// -- the buttons, which are the ones that must not be able to fail -----------

test("a d-pad button steers on pointerdown, not on click", () => {
  // A click waits for the release, and a game that waits for your finger to come
  // up feels broken long before it is.
  const sent = [];
  const root = element();
  pad(root, (i) => sent.push(i), {
    buttons: [{ label: "^", intent: DIRECTIONS.up, area: "up" }],
  });

  const [board] = root.children;
  const [button] = board.children;

  button.fire("pointerdown");
  assert.deepEqual(sent, [{ dir: "up" }]);

  // ...and no "click" handler exists at all.
  assert.equal(button.handlers.click, undefined);
});

test("a held button releases when the finger lifts, or slides off it", () => {
  const STOP = { paddle: 0 };
  const sent = [];
  const root = element();
  pad(root, (i) => sent.push(i), {
    hold: STOP,
    buttons: [{ label: "<", intent: { paddle: -1 }, area: "left" }],
  });

  const [board] = root.children;
  const [button] = board.children;

  button.fire("pointerdown");
  button.fire("pointerup");
  assert.deepEqual(sent, [{ paddle: -1 }, STOP]);

  // A finger that slides off the button must stop the paddle too, or it runs on
  // forever into the wall.
  sent.length = 0;
  button.fire("pointerdown");
  button.fire("pointerleave");
  assert.deepEqual(sent, [{ paddle: -1 }, STOP]);
});

test("every button a game offers is wired to an intent", () => {
  const sent = [];
  const root = element();
  pad(root, (i) => sent.push(i), {
    buttons: [
      { label: "^", intent: DIRECTIONS.up, area: "up" },
      { label: "<", intent: DIRECTIONS.left, area: "left" },
      { label: ">", intent: DIRECTIONS.right, area: "right" },
      { label: "v", intent: DIRECTIONS.down, area: "down" },
    ],
  });

  const [board] = root.children;
  for (const button of board.children) button.fire("pointerdown");

  assert.deepEqual(sent, [
    { dir: "up" },
    { dir: "left" },
    { dir: "right" },
    { dir: "down" },
  ]);
});

// -- the swipe, whose logic was never the problem ----------------------------

test("a swipe steers by its dominant axis", () => {
  for (const [dx, dy, expected] of [
    [0, -40, "up"],
    [0, 40, "down"],
    [-40, 0, "left"],
    [40, 0, "right"],
    [40, 12, "right"], // a sloppy diagonal still goes somewhere sensible
  ]) {
    const sent = [];
    const board = element();
    swipe(board, onChange((i) => sent.push(i.dir)), DIRECTIONS);

    board.fire("pointerdown", { clientX: 100, clientY: 100 });
    window.fire("pointermove", { clientX: 100 + dx, clientY: 100 + dy });

    assert.deepEqual(sent, [expected], `(${dx},${dy}) should swipe ${expected}`);
  }
});

test("a nudge is not a swipe", () => {
  const sent = [];
  const board = element();
  swipe(board, onChange((i) => sent.push(i.dir)), DIRECTIONS);

  board.fire("pointerdown", { clientX: 100, clientY: 100 });
  window.fire("pointermove", { clientX: 108, clientY: 104 });

  assert.deepEqual(sent, []);
});

test("a finger that strays off the board still steers", () => {
  // The old version listened for pointermove on the CANVAS and leaned on
  // setPointerCapture to keep receiving it. move/up now listen on the window, so
  // there is nothing exotic left in the path to misbehave.
  const sent = [];
  const board = element();
  swipe(board, onChange((i) => sent.push(i.dir)), DIRECTIONS);

  board.fire("pointerdown", { clientX: 100, clientY: 100 });
  window.fire("pointermove", { clientX: 100, clientY: 40 }); // ...off the canvas

  assert.deepEqual(sent, ["up"]);
});

// -- Pong's halves ------------------------------------------------------------

test("holding a side of the board steers that way, and letting go stops", () => {
  const STOP = { paddle: 0 };
  const sent = [];
  const board = element({ left: 0, width: 200 });

  halves(board, onChange((i) => sent.push(i)), {
    left: { paddle: -1 },
    right: { paddle: 1 },
    release: STOP,
  });

  board.fire("pointerdown", { clientX: 40 }); // left half
  board.fire("pointermove", { clientX: 160 }); // slid across the middle
  board.fire("pointerup", { clientX: 160 });

  assert.deepEqual(sent, [{ paddle: -1 }, { paddle: 1 }, STOP]);
});

test("one deduper serves every input, so a finger and a key cannot disagree", () => {
  const sent = [];
  const intend = onChange((i) => sent.push(i));
  const board = element();
  swipe(board, intend, DIRECTIONS);

  board.fire("pointerdown", { clientX: 100, clientY: 100 });
  window.fire("pointermove", { clientX: 100, clientY: 40 });
  window.fire("pointermove", { clientX: 100, clientY: 0 }); // still up

  assert.deepEqual(sent, [{ dir: "up" }], "the second up is the server's news");
});
