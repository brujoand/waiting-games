// The cards you clicked are the cards it plays.
//
// A move in Idiot is a list of INDEXES -- {cards: [0, 2]} -- and an index is a
// position, not a card. Three things can silently make it the wrong position: the
// hand changing under a selection made before it, the rack switching from your hand
// to the three on the table (an index into the wrong list is still a valid index),
// and a face-down card, which is played by clicking rather than by selecting.
//
// None of those fail loudly. They play a card you did not choose, on a pile you
// were looking at, and the game goes on. Hence a test that clicks.

import assert from "node:assert/strict";
import { test } from "node:test";

// -- just enough dom ---------------------------------------------------------

const element = (tag) => {
  const node = {
    tag,
    className: "",
    textContent: "",
    disabled: false,
    dataset: {},
    onclick: null,
    children: [],
    append(...kids) {
      node.children.push(...kids);
    },
    replaceChildren(...kids) {
      node.children = kids;
    },
  };
  return node;
};

globalThis.document = { createElement: element, documentElement: {} };
globalThis.window = { addEventListener() {}, dispatchEvent() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
// Node has a navigator of its own now, and it is read-only. i18n.js reads it to
// guess a language, and the assertions below are written in English.
Object.defineProperty(globalThis, "navigator", {
  value: { languages: ["en"], language: "en" },
  configurable: true,
});

const { create } = await import("../waiting_games/static/games/idiot.js");

// Every node under `root`, depth first, in the order they were appended.
function all(node, found = []) {
  for (const child of node.children ?? []) {
    found.push(child);
    all(child, found);
  }
  return found;
}

function within(root, className) {
  const holder = all(root).find((node) => node.className?.includes(className));
  return holder ? holder.children : [];
}

function button(root, label) {
  return all(root).find((node) => node.textContent === label);
}

const ME = { sub: "u-alice" };

// Alice to play, off a pile with a five on it.
function game(over = {}) {
  return {
    status: "active",
    phase: "playing",
    over: false,
    seat: 0,
    turn: "u-alice",
    winner: null,
    idiot: null,
    playerNames: { "u-alice": "Alice", "u-bob": "Bob" },
    order: ["u-alice", "u-bob"],
    ready: { "u-alice": true, "u-bob": true },
    pile: ["5C"],
    stock: 0,
    burnt: 0,
    finished: [],
    last: null,
    hand: ["7H", "8S", "9D"],
    table: {
      "u-alice": {
        up: ["QH", "QS", "QD"],
        hand: 3,
        down: 3,
        source: "hand",
        out: false,
      },
      "u-bob": { up: ["2C", "3C", "4C"], hand: 3, down: 3, source: "hand", out: false },
    },
    ...over,
  };
}

function mount(state) {
  const root = element("div");
  const sent = [];
  const renderer = create({ root, me: ME, send: (move) => sent.push(move) });
  renderer.update(state);
  return { root, sent, renderer };
}

// -- the tests ---------------------------------------------------------------

test("it plays the cards you clicked, by their position in your hand", () => {
  const { root, sent } = mount(game());

  const hand = within(root, "idiot-hand");
  assert.equal(hand.length, 3);

  hand[0].onclick(); // the 7...
  hand[2].onclick(); // ...and the 9, which is a ladder short of a ladder
  button(root, "Play").onclick();

  assert.deepEqual(sent, [{ cards: [0, 2] }]);
});

test("clicking a chosen card again takes it back", () => {
  const { root, sent } = mount(game());

  within(root, "idiot-hand")[1].onclick();
  within(root, "idiot-hand")[1].onclick(); // ...no, not that one

  assert.equal(button(root, "Play").disabled, true);
  assert.deepEqual(sent, []);
});

test("a selection does not outlive the hand it was made in", () => {
  // The bug this exists for: choose the card at index 2, the hand changes under
  // you -- you drew, or you were made to pick the pile up -- and index 2 is now a
  // completely different card. Playing it would be playing a card you never chose.
  const { root, renderer } = mount(game());

  within(root, "idiot-hand")[2].onclick();
  assert.equal(button(root, "Play").disabled, false);

  renderer.update(game({ hand: ["7H", "8S", "9D", "KC"] })); // she picked the pile up

  assert.equal(button(root, "Play").disabled, true, "the old selection survived");
});

test("when your hand is gone, the indexes are into the cards on the table", () => {
  // An index into the wrong list is still a perfectly valid index, so this cannot
  // fail loudly. It just plays the wrong card.
  const state = game({ hand: [] });
  state.table["u-alice"].hand = 0;
  state.table["u-alice"].source = "up";

  const { root, sent } = mount(state);

  assert.equal(within(root, "idiot-hand").length, 0);

  const table = within(root, "idiot-stacked")[1].children; // the face-up rack
  table[1].onclick(); // the middle queen
  button(root, "Play").onclick();

  assert.deepEqual(sent, [{ cards: [1] }]);
});

test("a face-down card is played by turning it over, not by choosing it", () => {
  const state = game({ hand: [] });
  Object.assign(state.table["u-alice"], { up: [], hand: 0, source: "down" });

  const { root, sent } = mount(state);

  const down = within(root, "idiot-stacked")[0].children;
  assert.equal(down.length, 3);

  down[2].onclick(); // no choosing, no Play button: it goes the moment you touch it

  assert.deepEqual(sent, [{ cards: [2] }]);
  assert.equal(button(root, "Play").disabled, true); // ...and there was nothing to press
});

test("you cannot play anything when it is not your turn", () => {
  const { root, sent } = mount(game({ turn: "u-bob" }));

  for (const card of within(root, "idiot-hand")) {
    assert.equal(card.disabled, true);
    assert.equal(card.onclick, null);
  }
  assert.equal(button(root, "Play").disabled, true);
  assert.equal(sent.length, 0);
});

test("a swap trades one card for one card", () => {
  const state = game({ phase: "swapping" });
  state.ready = { "u-alice": false, "u-bob": false };

  const { root, sent } = mount(state);

  within(root, "idiot-hand")[0].onclick(); // this one from my hand...
  within(root, "idiot-stacked")[1].children[2].onclick(); // ...for that one on the table

  assert.deepEqual(sent, [{ action: "swap", hand: 0, up: 2 }]);
});

test("choosing a second card to swap changes your mind rather than adding to it", () => {
  const state = game({ phase: "swapping" });
  state.ready = { "u-alice": false, "u-bob": false };

  const { root, sent } = mount(state);

  within(root, "idiot-hand")[0].onclick();
  within(root, "idiot-hand")[1].onclick(); // no, this one
  within(root, "idiot-stacked")[1].children[0].onclick();

  assert.deepEqual(sent, [{ action: "swap", hand: 1, up: 0 }]);
});

test("a spectator is shown the table and no hand at all", () => {
  // view(None) has no `hand` key, and the renderer must not assume it does: any
  // logged-in user may open the socket and watch.
  const watching = game();
  delete watching.hand;
  watching.seat = null;

  const { root } = mount(watching);

  assert.equal(within(root, "idiot-hand").length, 0);
  assert.ok(within(root, "idiot-table").length === 2, "the table did not render");
});
