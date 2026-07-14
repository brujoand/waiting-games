// The card you lifted is the card it moves.
//
// A move in Solitaire names a CARD -- {card: "9S", to: "t1"} -- which is already
// safer than an index into a list that is about to change under it. What is not safe
// is the lift: one click means "pick this up", the next means "put it down there",
// and which of the two a click IS depends on what is already in your hand. Get that
// wrong and the renderer sends a perfectly valid move for a card the player was not
// touching. Nothing throws. The board just does something else.
//
// So this test clicks. It is also the only check that a SPECTATOR cannot: they see
// the same board the player does -- there is no hidden state to separate them -- and
// the only thing standing between them and a move is that every card comes out
// disabled.

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
    ondblclick: null,
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
Object.defineProperty(globalThis, "navigator", {
  value: { languages: ["en"], language: "en" },
  configurable: true,
});

const { create, outcome } = await import(
  "../waiting_games/static/games/solitaire.js"
);

function all(node, found = []) {
  for (const child of node.children ?? []) {
    found.push(child);
    all(child, found);
  }
  return found;
}

function nodes(root, className) {
  return all(root).filter((node) => node.className?.split(" ").includes(className));
}

// The cards in one column, in the order they are stacked.
function column(root, index) {
  return nodes(root, "sol-column")[index].children;
}

const ME = { sub: "u-alice" };

// A board mid-game: a run of two in the first column, a face-down card under the
// second, an empty column, a king, an ace already home, and three cards left to turn.
function game(changes = {}) {
  return {
    status: "active",
    over: false,
    draw: false,
    seat: 0,
    winner: null,
    playerNames: { "u-alice": "Alice" },
    suits: "SHDC",
    columns: [
      { down: 0, up: ["9S", "8H"] },
      { down: 1, up: ["TH"] },
      { down: 0, up: [] },
      { down: 0, up: ["KC"] },
      { down: 0, up: [] },
      { down: 0, up: [] },
      { down: 0, up: [] },
    ],
    foundations: [["AS"], [], [], []],
    waste: ["2D", "7C"],
    stock: 3,
    score: 1,
    cards: 52,
    moves: 4,
    recycles: 0,
    ...changes,
  };
}

function mount(state) {
  const root = element("div");
  const sent = [];
  const renderer = create({ root, me: ME, send: (move) => sent.push(move) });
  renderer.update(state);
  return { root, sent, renderer };
}

// -- lifting and putting down --------------------------------------------------

test("lifting a card and clicking another column moves it there", () => {
  const { root, sent } = mount(game());

  column(root, 0)[0].onclick(); // the 9S...
  column(root, 1)[1].onclick(); // ...onto the red ten in the next column

  assert.deepEqual(sent, [{ card: "9S", to: "t1" }]);
});

test("the run under a lifted card lifts with it", () => {
  const { root, sent } = mount(game());

  column(root, 0)[0].onclick(); // the 9S, with the 8H sitting on it

  assert.equal(column(root, 0)[0].dataset.chosen, "true");
  assert.equal(column(root, 0)[1].dataset.chosen, "true"); // it is coming too
  assert.deepEqual(sent, []); // ...and nothing has been sent: a lift is not a move
});

test("clicking the lifted card again puts it back down", () => {
  const { root, sent } = mount(game());

  column(root, 0)[0].onclick();
  column(root, 0)[0].onclick();

  assert.equal(column(root, 0)[0].dataset.chosen, undefined);
  assert.deepEqual(sent, []);
});

test("clicking another card in the SAME column is a change of mind, not a move", () => {
  // There is nowhere for a card to go inside its own column, so this can only ever
  // mean "not that one, this one" -- and a renderer that read it as a move would
  // send one the server would refuse, for a card the player had already let go of.
  const { root, sent } = mount(game());

  column(root, 0)[0].onclick(); // the 9S...
  column(root, 0)[1].onclick(); // ...no, just the 8H

  assert.deepEqual(sent, []);
  assert.equal(column(root, 0)[0].dataset.chosen, undefined);
  assert.equal(column(root, 0)[1].dataset.chosen, "true");
});

test("a king can be dropped into an empty column", () => {
  const { root, sent } = mount(game());

  column(root, 3)[0].onclick(); // the KC
  // The hole in column 2 -- and it has to be found THROUGH the column, because an
  // empty foundation is a card-shaped hole too, and three of those are drawn first.
  column(root, 2)[0].onclick();

  assert.deepEqual(sent, [{ card: "KC", to: "t2" }]);
});

test("a card from the waste is the one that moves", () => {
  const { root, sent } = mount(game());

  // Only the TOP of the waste is drawn, so this can only be the 7C. The 2D under it
  // has been seen and is out of play.
  const waste = nodes(root, "sol-waste")[0].children;
  assert.equal(waste.length, 1);

  waste[0].onclick();
  column(root, 1)[1].onclick();

  assert.deepEqual(sent, [{ card: "7C", to: "t1" }]);
});

// -- the foundations are one target, not four ----------------------------------

test("any foundation sends the card home, and the server works out which", () => {
  // A card can only ever go home to its own suit, so the browser is never asked to
  // aim. Dropping the club on the HEARTS pile still says "f" -- and the alternative,
  // a renderer that worked out the right pile for itself, is a second rulebook.
  const { root, sent } = mount(game());

  const waste = nodes(root, "sol-waste")[0].children;
  waste[0].onclick(); // the 7C
  nodes(root, "sol-foundation")[1].children[0].onclick(); // the empty HEARTS pile

  assert.deepEqual(sent, [{ card: "7C", to: "f" }]);
});

test("a card comes back off a foundation the same way it went on", () => {
  const { root, sent } = mount(game());

  nodes(root, "sol-foundation")[0].children[0].onclick(); // lift the AS back off
  column(root, 0)[1].onclick(); // ...onto the 8H, which the server will refuse

  // The renderer does not know that, does not guess, and sends what was asked for.
  assert.deepEqual(sent, [{ card: "AS", to: "t0" }]);
});

test("double-clicking a card sends it straight home", () => {
  const { root, sent } = mount(game());

  column(root, 1)[1].ondblclick(); // the TH

  assert.deepEqual(sent, [{ card: "TH", to: "f" }]);
});

// -- the stock -----------------------------------------------------------------

test("clicking the stock turns one card", () => {
  const { root, sent } = mount(game());

  nodes(root, "sol-stock")[0].children[0].onclick();

  assert.deepEqual(sent, [{ draw: true }]);
});

test("an empty stock offers the waste back, and it is still a draw", () => {
  const { root, sent } = mount(game({ stock: 0 }));

  const again = nodes(root, "sol-again")[0];
  assert.ok(again); // the only button on the board that is not a card
  again.onclick();

  assert.deepEqual(sent, [{ draw: true }]);
});

test("with nothing left to turn there is nothing to click", () => {
  const { root } = mount(game({ stock: 0, waste: [] }));

  assert.equal(nodes(root, "sol-again").length, 0);
  assert.equal(nodes(root, "sol-stock")[0].children.length, 1); // just the count
});

// -- what nobody may touch -----------------------------------------------------

test("a face-down card cannot be turned over by hand", () => {
  // It turns itself over, the moment the card sitting on it leaves. There is no move
  // for a player to make here and so there is no click.
  const { root } = mount(game());

  const buried = column(root, 1)[0];
  assert.ok(buried.className.includes("card-back"));
  assert.equal(buried.disabled, true);
  assert.equal(buried.onclick, null);
});

test("a spectator can look at the board and do nothing else", () => {
  // They see exactly what the player sees -- there is no hidden state in this game to
  // separate the two views -- so being unable to MOVE is the only thing that makes
  // them a spectator.
  const { root } = mount(game({ seat: null }));

  for (const card of nodes(root, "card")) {
    assert.equal(card.disabled, true);
    assert.equal(card.onclick, null);
  }
  for (const hole of nodes(root, "sol-ghost")) assert.equal(hole.disabled, true);
  assert.equal(nodes(root, "sol-stock")[0].children[0].disabled, true);
});

test("a finished game cannot be played on", () => {
  const { root } = mount(game({ over: true, status: "finished" }));

  for (const card of nodes(root, "card")) assert.equal(card.disabled, true);
});

// -- the board changing under a lifted card ------------------------------------

test("a lifted card that is no longer in play is put back down", () => {
  const { root, renderer } = mount(game());

  const waste = nodes(root, "sol-waste")[0].children;
  waste[0].onclick(); // lift the 7C
  assert.equal(nodes(root, "sol-waste")[0].children[0].dataset.chosen, "true");

  // ...and now a state arrives in which another card has been turned on top of it.
  renderer.update(game({ waste: ["2D", "7C", "5H"] }));

  for (const card of nodes(root, "card")) {
    assert.equal(card.dataset.chosen, undefined);
  }
});

// -- how it ends ---------------------------------------------------------------

test("a dead board is a loss, not a draw", () => {
  // On the wire it is a draw: a solo run has nobody to lose TO, so Result.draw() is
  // the only honest thing the platform can be told. In the room it is a game that
  // just died, and a neutral never-mind chime for that is exactly backwards.
  assert.equal(outcome(game({ over: true, draw: true, seat: 0 })), "lose");

  // A win is still a win: the platform already has that one right.
  assert.equal(outcome(game({ over: true, winner: "u-alice", seat: 0 })), null);

  // And a spectator lost nothing.
  assert.equal(outcome(game({ over: true, draw: true, seat: null })), null);
});
