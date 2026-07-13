// The input layer, driven through a minimal fake DOM.
//
// A swipe shipped once and did not work on a phone at all. The logic was fine --
// these tests passed then too -- and the cause turned out to be setPointerCapture
// on the canvas swallowing the gesture. Listening for pointermove/pointerup on
// the WINDOW instead fixed it, which is why the last test here exists: it is the
// one that would fail if somebody reintroduced element-level capture.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { halves, onChange, swipe } from "../waiting_games/static/games/_canvas.js";

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

// -- the swipe -------------------------------------------------------------

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
  // THE regression test. The first version listened for pointermove on the CANVAS
  // and leaned on setPointerCapture to keep receiving it -- and on a real phone
  // that combination silently ate every swipe. move/up listen on the window now.
  // If this test ever fails, somebody has put the capture back and the game is
  // unplayable on a touchscreen again.
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
