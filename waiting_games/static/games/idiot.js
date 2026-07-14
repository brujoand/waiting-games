// Idiot.
//
// Three rows, and they are the three places a card can be. The TABLE at the top --
// everybody else, their face-up cards, and how much they are still holding. The
// PILE in the middle, which is the only thing you are ever answering. And your own
// nine cards at the bottom, in the order you will be forced to play them: hand
// first, then the three you laid face up, then the three you have never seen.
//
// You select cards and then play them, rather than playing on click, because a
// ladder is several cards at once and there is no way to know you have finished
// choosing one until you say so. The exception is a face-down card: there is
// nothing to choose, so turning it over IS the move.

import { t } from "../i18n.js";
import { back, card } from "./_cards.js";
import { who } from "./_score.js";

export function create({ root, me, send }) {
  root.className = "board-idiot";

  // Which of my cards are picked up off the rack, by index into whatever I am
  // currently playing from. Kept here rather than in the dom, because the board
  // repaints on every move anybody at the table makes.
  let chosen = new Set();
  // ...and dropped the moment those cards stop being those cards. An index is a
  // position, not a card: play a 7 out of the middle of a hand and index 2 is a
  // different card than it was, so a selection that outlived the hand it was made
  // in would quietly play the wrong one.
  let rack = "";
  let current = null;

  // A selection is a repaint, not a move: nothing has been sent, and the server
  // has not changed its mind about anything.
  function paint() {
    const game = current;
    const seated = Array.isArray(game.hand);

    root.replaceChildren(
      ...[
        table(game, me),
        middle(game),
        seated ? previously(game, me) : null,
        seated ? myCards(game, me, send, chosen, pick) : null,
        seated ? actions(game, me, send, chosen) : null,
      ].filter(Boolean),
    );
  }

  function pick(index) {
    // A swap trades ONE card for one card, so choosing a second means changing
    // your mind. A play can be a whole ladder, so it means adding to it.
    const single = current.phase === "swapping";
    if (chosen.has(index)) chosen.delete(index);
    else if (single) chosen = new Set([index]);
    else chosen.add(index);
    paint();
  }

  return {
    update(game) {
      current = game;
      const seat = mySeat(game, me);
      const signature = [
        game.phase,
        seat?.source,
        (game.hand ?? []).join(),
        (seat?.up ?? []).join(),
      ].join("|");

      if (signature !== rack) {
        chosen = new Set();
        rack = signature;
      }
      paint();
    },

    destroy() {},
  };
}

function mySeat(game, me) {
  return game.table?.[me.sub] ?? null;
}

function myTurn(game, me) {
  return game.status === "active" && !game.over && game.turn === me.sub;
}

// -- the table: everyone, and how much of the game they are still holding -----

function table(game, me) {
  const list = document.createElement("ul");
  list.className = "idiot-table";

  for (const sub of game.order ?? []) {
    list.append(player(game, me, sub));
  }
  return list;
}

function player(game, me, sub) {
  const seat = game.table[sub];

  const row = document.createElement("li");
  row.className = "idiot-player";
  if (sub === me.sub) row.dataset.me = "true";
  if (game.turn === sub && !game.over) row.dataset.turn = "true";
  if (seat.out) row.dataset.out = "true";
  if (game.idiot === sub) row.dataset.idiot = "true";

  const name = document.createElement("span");
  name.className = "idiot-name";
  name.textContent = who(game, me, sub);

  // What they are holding, as cards rather than as numbers: a player down to two
  // cards is the whole tension of the game, and "2" does not look like anything.
  const held = document.createElement("span");
  held.className = "idiot-held";
  for (let i = 0; i < seat.hand; i++) held.append(pip("hand"));
  for (let i = 0; i < seat.down; i++) held.append(pip("down"));

  const up = document.createElement("span");
  up.className = "idiot-up";
  for (const code of seat.up) up.append(card(code));

  const chip = document.createElement("span");
  chip.className = "idiot-chip";
  if (game.phase === "swapping") {
    chip.textContent = game.ready[sub] ? t("idiot.chip.ready") : t("idiot.chip.swapping");
  } else if (seat.out) {
    chip.textContent = t("idiot.chip.out");
  } else {
    chip.textContent = t(`idiot.chip.${seat.source}`);
  }

  row.append(name, up, held, chip);
  return row;
}

function pip(kind) {
  const mark = document.createElement("i");
  mark.className = "idiot-pip";
  mark.dataset.kind = kind;
  return mark;
}

// -- the middle: the pile, and what is left of the deck -----------------------

function middle(game) {
  const wrap = document.createElement("div");
  wrap.className = "idiot-middle";

  wrap.append(counter("idiot.stock", game.stock));

  const pile = document.createElement("div");
  pile.className = "idiot-pile";
  if (game.pile.length === 0) {
    const empty = document.createElement("span");
    empty.className = "idiot-empty";
    empty.textContent = t("idiot.pile_is_empty");
    pile.append(empty);
  } else {
    // The last few, overlapping, newest on top. Not just the top card: four of a
    // kind burns the pile, and you cannot see one coming if you can only see one.
    for (const code of game.pile.slice(-4)) pile.append(card(code));
  }

  const stack = document.createElement("div");
  stack.className = "idiot-stack";
  stack.append(pile);

  const count = document.createElement("span");
  count.className = "idiot-count";
  count.textContent = t("idiot.pile_count", { count: game.pile.length });
  stack.append(count);

  wrap.append(stack, counter("idiot.burnt", game.burnt));
  return wrap;
}

function counter(key, value) {
  const box = document.createElement("div");
  box.className = "idiot-counter";

  const number = document.createElement("b");
  number.textContent = String(value);

  const label = document.createElement("span");
  label.textContent = t(key);

  box.append(number, label);
  return box;
}

// -- what just happened -------------------------------------------------------

// A card game where you can only see the state you are left with is unplayable:
// a face-down card that missed, and the pile it dragged away with it, is otherwise
// just a hand that silently grew by nine.
function previously(game, me) {
  if (!game.last) return null;

  const note = document.createElement("p");
  note.className = "idiot-note";
  const name = who(game, me, game.last.player);
  const { played, burned, picked } = game.last;

  if (played.length && picked) {
    note.textContent = t("idiot.last.blind_miss", { name, count: picked });
  } else if (burned) {
    note.textContent = t("idiot.last.burned", { name });
  } else if (picked) {
    note.textContent = t("idiot.last.picked", { name, count: picked });
  } else {
    return null; // an ordinary card on an ordinary pile speaks for itself
  }

  return note;
}

// -- your own nine ------------------------------------------------------------

function myCards(game, me, send, chosen, pick) {
  const seat = mySeat(game, me);
  const wrap = document.createElement("div");
  wrap.className = "idiot-mine";

  const swapping = game.phase === "swapping";
  const turn = myTurn(game, me);

  // The three you laid face up. In the deal they are the other half of the swap;
  // in the game they are what you play once your hand is gone.
  const up = document.createElement("div");
  up.className = "idiot-rack";
  seat.up.forEach((code, index) => {
    const live =
      (swapping && !game.ready[me.sub] && chosen.size === 1) ||
      (turn && seat.source === "up");
    const button = card(code, {
      onclick: live
        ? () => (swapping ? swap(send, chosen, index) : pick(index))
        : null,
    });
    if (!swapping && seat.source === "up" && chosen.has(index)) {
      button.dataset.chosen = "true";
    }
    up.append(button);
  });

  // ...and the three underneath them, which nobody has seen -- not even you.
  const down = document.createElement("div");
  down.className = "idiot-rack";
  for (let index = 0; index < seat.down; index++) {
    const blind = turn && seat.source === "down";
    down.append(back({ onclick: blind ? () => send({ cards: [index] }) : null }));
  }

  const hand = document.createElement("div");
  hand.className = "idiot-rack idiot-hand";
  game.hand.forEach((code, index) => {
    const live = swapping ? !game.ready[me.sub] : turn && seat.source === "hand";
    const button = card(code, { onclick: live ? () => pick(index) : null });
    if (chosen.has(index) && (swapping || seat.source === "hand")) {
      button.dataset.chosen = "true";
    }
    hand.append(button);
  });

  wrap.append(stacked(down, up), hand);
  return wrap;
}

// The face-up three sit ON the face-down three, which is exactly how they sit on a
// real table and exactly why you play them in that order.
function stacked(down, up) {
  const wrap = document.createElement("div");
  wrap.className = "idiot-stacked";
  wrap.append(down, up);
  return wrap;
}

function swap(send, chosen, up) {
  const [hand] = [...chosen];
  send({ action: "swap", hand, up });
}

// -- the buttons --------------------------------------------------------------

function actions(game, me, send, chosen) {
  const row = document.createElement("div");
  row.className = "row idiot-actions";

  if (game.phase === "swapping") {
    const ready = document.createElement("button");
    ready.className = "primary";
    ready.disabled = game.ready[me.sub];
    ready.textContent = game.ready[me.sub] ? t("idiot.waiting") : t("idiot.ready");
    ready.onclick = () => send({ action: "ready" });
    row.append(ready);
    return row;
  }

  const seat = mySeat(game, me);
  const turn = myTurn(game, me);

  const play = document.createElement("button");
  play.className = "primary";
  play.textContent = t("idiot.play");
  play.disabled = !turn || chosen.size === 0 || seat.source === "down";
  play.onclick = () => send({ cards: [...chosen] });

  const pickup = document.createElement("button");
  pickup.textContent = t("idiot.pick_up", { count: game.pile.length });
  pickup.disabled = !turn || game.pile.length === 0;
  pickup.onclick = () => send({ action: "pickup" });

  row.append(play, pickup);
  return row;
}

// -- the status line ----------------------------------------------------------

export function describe(game, me) {
  // Deliberately not `!== "active"`: a finished session's status is "finished",
  // and that test would swallow every line below.
  if (game.status === "waiting") return null;

  if (game.over) {
    if (game.idiot === me.sub) return t("idiot.you_are_the_idiot");
    return t("idiot.the_idiot", { name: game.playerNames[game.idiot] });
  }

  if (game.phase === "swapping") {
    if (!game.ready?.[me.sub]) return t("idiot.swap");

    const waiting = (game.order ?? [])
      .filter((sub) => sub !== me.sub && !game.ready[sub])
      .map((sub) => game.playerNames[sub]);
    return t("idiot.waiting_for", { names: waiting.join(", ") });
  }

  const seat = mySeat(game, me);
  if (!myTurn(game, me)) {
    return t("ui.their_turn", { name: game.playerNames[game.turn] });
  }
  // Whose turn it is, and -- because this is the rule people forget -- WHICH of
  // your three sets of cards the game is making you play from.
  if (seat.source === "down") return t("idiot.your_turn_blind");
  if (seat.source === "up") return t("idiot.your_turn_up");
  return t("ui.your_turn");
}

export function outcome(game, me) {
  // The platform reads `winner`, and the winner is whoever got out FIRST -- so
  // everybody else, including the three players who got out perfectly comfortably
  // in a five-hander, would be told they lost. Only one player loses this game.
  if (!game.over || game.seat === null || game.seat === undefined) return null;
  return game.idiot === me.sub ? "lose" : "win";
}
