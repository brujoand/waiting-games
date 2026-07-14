// Solitaire.
//
// The stock and the waste on the left, the four foundations on the right, and the
// seven columns underneath -- which is where the whole game actually happens.
//
// You LIFT a card and then put it down somewhere, rather than dragging it. Dragging
// is what a solitaire does on a desktop and it is miserable on a phone, and half the
// people who play this will be standing up. Lifting is one tap and one tap, it works
// with a mouse, and it is the same gesture Gris and Idiot already use for a card you
// have chosen but not yet played -- so it is also the same lift, in CSS.
//
// The renderer knows nothing about the rules and must not learn any. It does not
// know whether a card fits where you dropped it; it asks, and the server says. A
// second rulebook in here would not fail loudly -- it would just quietly disagree
// with the first one, on some board, one day.

import { t } from "../i18n.js";
import { PIPS, back, card } from "./_cards.js";

export function create({ root, me, send }) {
  root.className = "board-solitaire";

  // The card lifted off the board, or null. It lives here rather than in the dom
  // because lifting one is a REPAINT, not a move: nothing has been sent, and the
  // server has not changed its mind about anything.
  let picked = null;
  let current = null;

  function paint() {
    const game = current;
    // A spectator may watch, and watching is all: every card comes out inert. There
    // is no seat-specific view in this game -- they are looking at the same board the
    // player is -- so this is the only thing that separates them.
    const live = seated(game) && !game.over;

    root.replaceChildren(
      ...[
        deal(game, live),
        tableau(game, live),
        live ? hint() : null,
      ].filter(Boolean),
    );
  }

  function lift(code) {
    picked = code;
    paint();
  }

  function place(to) {
    const code = picked;
    // Put it down BEFORE sending. The board is about to change under us, and a
    // selection that outlived the board it was made on would be pointing at a card
    // that has moved. If the server refuses the move it says why, and the card is
    // still there to be picked up again.
    picked = null;
    send({ card: code, to });
    paint();
  }

  function draw() {
    picked = null;
    send({ draw: true });
    paint();
  }

  // A card in a column, or the one on top of the waste.
  function touch(code, column) {
    if (!picked) return lift(code);
    if (picked === code) return lift(null); // put it back down
    // Another card in the column the lifted one is already in: a change of mind,
    // not a move. There is nowhere for a card to go inside its own column.
    if (column !== null && column === columnOf(current, picked)) return lift(code);
    // The waste is not a place a card can land, so clicking it is a change of mind
    // too. Any other column is a destination.
    return column === null ? lift(code) : place(`t${column}`);
  }

  // The foundations are one target, not four: a card can only go home to its own
  // suit, so the server is told "f" and works out which. Dropping the queen of
  // hearts on the spades therefore does the right thing rather than the rude thing.
  function home(top) {
    if (picked && picked !== top) return place("f");
    if (top) return lift(picked === top ? null : top); // ...or bring it back down
  }

  // -- the top row: where the cards come from, and where they are going ---------

  function deal(game, live) {
    const row = document.createElement("div");
    row.className = "sol-deal";

    row.append(stock(game, live), waste(game, live), gap());
    game.foundations.forEach((pile, index) =>
      row.append(foundation(game, live, pile, index)),
    );
    return row;
  }

  function stock(game, live) {
    const pile = slot("sol-stock");

    if (game.stock) {
      pile.append(back({ onclick: live ? draw : null }));
    } else if (game.waste.length) {
      // The stock is empty and the waste is not, so it comes round again. This is
      // the only button on the board that is not a card.
      const again = document.createElement("button");
      again.className = "sol-again";
      again.textContent = "↻";
      again.disabled = !live;
      again.onclick = draw;
      pile.append(again);
    }
    // ...and if both are empty, an empty slot. There is nothing left to turn, and
    // nothing to click: every card is on the table.

    const count = document.createElement("small");
    count.textContent = String(game.stock);
    pile.append(count);
    return pile;
  }

  function waste(game, live) {
    const pile = slot("sol-waste");
    const top = game.waste[game.waste.length - 1];
    // Only the top card. The ones under it have been seen and are out of play, and
    // fanning them out would be showing the player a memory they already have.
    if (top) pile.append(face(top, live, null));
    return pile;
  }

  function foundation(game, live, cards, index) {
    const suit = game.suits[index];
    const pile = slot("sol-foundation");
    const top = cards[cards.length - 1];

    if (top) {
      pile.append(face(top, live, null, () => home(top)));
    } else {
      // A card-shaped hole with the missing suit ghosted in it, which is also the
      // clearest way of saying which aces are still out there somewhere.
      const empty = document.createElement("button");
      empty.className = "sol-ghost";
      empty.dataset.suit = suit;
      empty.textContent = PIPS[suit];
      empty.disabled = !live;
      empty.onclick = () => home(null);
      pile.append(empty);
    }
    return pile;
  }

  // -- the seven columns --------------------------------------------------------

  function tableau(game, live) {
    const grid = document.createElement("div");
    grid.className = "sol-tableau";

    game.columns.forEach((column, index) => {
      const pile = document.createElement("div");
      pile.className = "sol-column";

      // A face-down card has no click. You do not turn one over -- it turns itself
      // over, the moment the card sitting on it leaves.
      for (let n = 0; n < column.down; n += 1) pile.append(back());
      for (const code of column.up) pile.append(face(code, live, index));

      if (!column.down && !column.up.length) {
        const empty = document.createElement("button");
        empty.className = "sol-ghost";
        empty.disabled = !live || !picked;
        empty.onclick = () => place(`t${index}`);
        pile.append(empty);
      }

      grid.append(pile);
    });
    return grid;
  }

  // Is this card coming with the lifted one? Everything below a card in a column
  // moves with it, so everything below it lifts with it -- otherwise the player is
  // shown one card leaving and then five of them land.
  //
  // Note this asks a question about POSITION, not about rules: "what is underneath
  // it" is not something the server has to be consulted about. Whether the run may
  // go where they are about to drop it still is.
  function riding(game, code) {
    if (!picked) return false;
    if (code === picked) return true;

    const column = columnOf(game, picked);
    if (column < 0) return false; // the lifted card is in the waste, and rides alone

    const up = game.columns[column].up;
    // -1 for a card in some other column, which is never below anything here.
    return up.indexOf(code) > up.indexOf(picked);
  }

  // A card face-up on the board: the thing you lift, and the thing you land on.
  function face(code, live, column, onclick = null) {
    const element = card(code, {
      onclick: live ? onclick || (() => touch(code, column)) : null,
    });
    if (riding(current, code)) element.dataset.chosen = "true";
    // Straight home, without picking it up first -- the move you make forty times in
    // a game once the foundations get going.
    //
    // Not on a card that is already home, though (those are the ones passed an
    // onclick of their own). Sending it there again is a move the server can only
    // refuse, and a red toast for a double-click on the right pile is a punishment
    // for enthusiasm.
    if (live && !onclick) {
      element.ondblclick = () => {
        picked = null;
        send({ card: code, to: "f" });
      };
    }
    return element;
  }

  return {
    update(game) {
      current = game;
      // A card that is no longer face-up is no longer lifted. It cannot normally
      // happen -- place() puts the card down before it sends -- but a state can also
      // arrive out of the blue (a reconnect), and a selection pointing at a card that
      // has moved would put the lift on the wrong one.
      if (picked && !available(game).has(picked)) picked = null;
      paint();
    },

    destroy() {},
  };
}

// -- odds and ends -------------------------------------------------------------

function slot(className) {
  const pile = document.createElement("div");
  pile.className = `sol-slot ${className}`;
  return pile;
}

function gap() {
  const spacer = document.createElement("div");
  spacer.className = "sol-gap";
  return spacer;
}

function hint() {
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = t("solitaire.hint");
  return note;
}

function seated(game) {
  // Seat 0 is a real seat and it is also falsy, so this cannot be `!game.seat`.
  return game.seat !== null && game.seat !== undefined;
}

function columnOf(game, code) {
  return game.columns.findIndex((column) => column.up.includes(code));
}

// Every card the player can actually touch: the face-up ones, the top of the waste,
// and the top of each foundation.
function available(game) {
  const cards = new Set(game.columns.flatMap((column) => column.up));
  const top = game.waste[game.waste.length - 1];
  if (top) cards.add(top);
  for (const pile of game.foundations) {
    if (pile.length) cards.add(pile[pile.length - 1]);
  }
  return cards;
}

export function describe(game, me) {
  // Deliberately not `!== "active"`: a finished session's status is "finished", and
  // that test would swallow every game-over line below.
  if (game.status === "waiting") return null;

  const score = { score: game.score, cards: game.cards };

  if (game.over) {
    if (game.winner === me.sub) return t("solitaire.you_won", { moves: game.moves });
    if (!seated(game)) return t("solitaire.run_over_watched", score);
    return t("solitaire.stuck", score);
  }

  return seated(game) ? t("solitaire.score", score) : t("solitaire.watching", score);
}

export function outcome(game) {
  // A solo run has nobody to lose TO, so a dead board ends as a DRAW on the wire --
  // see solitaire.py, and 2048, which ends the same way. In the room, a neutral
  // never-mind chime for a game that just died is exactly backwards.
  //
  // A win is still a win: leave that one to the platform.
  if (!seated(game)) return null;
  return game.draw ? "lose" : null;
}
