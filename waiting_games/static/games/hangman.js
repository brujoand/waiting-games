// Hangman.
//
// The setter types a word; everyone else picks letters off a keyboard. The word
// only ever reaches the setter's browser -- the server masks it for everyone
// else, so there is nothing here to hide.

import { t } from "../i18n.js";
import { who } from "./_score.js";

const SVG = "http://www.w3.org/2000/svg";

// The gallows itself: always there, from the first guess. It is the scenery, not
// the score.
const FRAME = [
  ["line", { x1: 20, y1: 196, x2: 104, y2: 196 }], // base
  ["line", { x1: 44, y1: 196, x2: 44, y2: 16 }], // post
  ["line", { x1: 44, y1: 16, x2: 124, y2: 16 }], // beam
  ["line", { x1: 44, y1: 48, x2: 76, y2: 16 }], // brace
];

// One per wrong guess, in the order they appear. There are exactly MAX_WRONG of
// them, and that is not a coincidence: the server ends the round on the seventh
// wrong guess, and the seventh part is the one that completes the figure. One
// short and the fatal guess hangs nobody; one long and a part can never be
// reached. The two numbers live in different files and different languages, so
// nothing but a test can hold them together -- see
// test_the_gallows_has_a_part_for_every_wrong_guess.
const PARTS = [
  ["line", { x1: 124, y1: 16, x2: 124, y2: 44 }], // rope
  ["circle", { cx: 124, cy: 60, r: 16 }], // head
  ["line", { x1: 124, y1: 76, x2: 124, y2: 132 }], // body
  ["line", { x1: 124, y1: 90, x2: 98, y2: 116 }], // left arm
  ["line", { x1: 124, y1: 90, x2: 150, y2: 116 }], // right arm
  ["line", { x1: 124, y1: 132, x2: 100, y2: 168 }], // left leg
  ["line", { x1: 124, y1: 132, x2: 148, y2: 168 }], // right leg
];

export function create({ root, me, send }) {
  root.className = "board-hangman";

  // How many parts were on screen last time we drew. Only a part that is NEW
  // gets the draw-in animation: without this, every state push would re-animate
  // the whole figure, and a correct guess would make the gallows twitch.
  //
  // null, not 0, because arriving mid-round is not the same as watching it
  // happen -- someone who reloads on 4 wrong guesses should find four parts
  // already standing there, not watch the fourth get drawn for them.
  let shown = null;

  return {
    update(game) {
      const setting = game.phase === "setting";
      const iAmSetter = game.setter === me.sub;
      const wrong = game.wrong.length;
      const fresh = shown !== null && wrong > shown;
      shown = wrong;

      root.replaceChildren(
        previously(game),
        setting
          ? iAmSetter
            ? wordForm(send)
            : note(t("hangman.waiting_for_setter", { name: game.playerNames[game.setter] }))
          : play(game, me, send, iAmSetter, fresh),
      );
    },

    destroy() {},
  };
}

function shape(kind, attributes, className) {
  const node = document.createElementNS(SVG, kind);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  if (className) node.setAttribute("class", className);
  return node;
}

function gallows(wrong, max, fresh) {
  const drawing = document.createElementNS(SVG, "svg");
  drawing.setAttribute("viewBox", "0 0 200 210");
  drawing.setAttribute("class", "hm-gallows");
  // It is decoration for a sighted player and noise for a screen reader, which
  // is already being told the count in words right beside it.
  drawing.setAttribute("aria-hidden", "true");

  for (const [kind, attributes] of FRAME) {
    drawing.append(shape(kind, attributes, "hm-frame"));
  }

  PARTS.slice(0, wrong).forEach(([kind, attributes], index) => {
    // Only the part that has just appeared animates.
    const last = fresh && index === wrong - 1;
    drawing.append(shape(kind, attributes, last ? "hm-part hm-new" : "hm-part"));
  });

  // Doomed: the drawing is complete, so say so in a way you cannot miss.
  if (wrong >= max) drawing.setAttribute("data-hanged", "true");

  return drawing;
}

function play(game, me, send, iAmSetter, fresh) {
  const wrap = document.createElement("div");

  wrap.append(gallows(game.wrong.length, game.maxWrong, fresh));

  const word = document.createElement("p");
  word.className = "hm-word";
  // The setter's payload carries the real word; nobody else's does.
  word.textContent = (iAmSetter ? game.word : game.revealed).split("").join(" ");
  wrap.append(word);

  const tally = document.createElement("p");
  tally.className = "hm-tally";
  tally.textContent = t("hangman.wrong_count", {
    wrong: game.wrong.length,
    max: game.maxWrong,
  });
  wrap.append(tally);

  const keys = document.createElement("div");
  keys.className = "hm-keys";
  const myTurn = !game.over && !iAmSetter && game.turn === me.sub;

  for (const letter of game.alphabet) {
    const key = document.createElement("button");
    key.className = "hm-key";
    key.textContent = letter;
    const tried = game.letters.includes(letter);
    key.disabled = tried || !myTurn;
    if (tried) key.dataset.hit = game.wrong.includes(letter) ? "false" : "true";
    key.onclick = () => send({ letter });
    keys.append(key);
  }
  wrap.append(keys);

  if (iAmSetter) {
    wrap.append(note(t("hangman.you_set_it")));
  }
  return wrap;
}

function wordForm(send) {
  const form = document.createElement("form");
  form.className = "hm-form";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = t("hangman.type_a_word");
  input.autocomplete = "off";
  input.maxLength = 20;

  const button = document.createElement("button");
  button.className = "primary";
  button.type = "submit";
  button.textContent = t("hangman.set_the_word");

  form.onsubmit = (event) => {
    event.preventDefault();
    if (input.value.trim()) send({ word: input.value });
    input.value = "";
  };

  form.append(input, button);
  return form;
}

function previously(game) {
  if (!game.previous) return document.createComment("");
  const { word, solved, setter } = game.previous;
  return note(
    t("hangman.previous", {
      name: game.playerNames[setter],
      word,
      outcome: solved ? t("hangman.was_guessed") : t("hangman.was_not_guessed"),
    }),
  );
}

function note(text) {
  const element = document.createElement("p");
  element.className = "hm-note";
  element.textContent = text;
  return element;
}

export function describe(game, me) {
  // Not before the board is dealt. This is deliberately NOT `!== "active"`:
  // a finished session's status is "finished", so that test quietly swallowed
  // every game-over line below it and left the platform's generic one to speak
  // for a game it does not understand.
  if (game.status === "waiting") return null;

  const score = Object.entries(game.counts)
    .map(([sub, n]) => `${who(game, me, sub)} ${n}`)
    .join(" - ");
  const round = t("hangman.round", { round: game.round, rounds: game.rounds });

  if (game.over) {
    if (game.draw) return `${score}. ${t("ui.draw")}`;
    return game.winner === me.sub
      ? `${score}. ${t("ui.you_won")}`
      : `${score}. ${t("ui.they_won", { name: game.playerNames[game.winner] })}`;
  }

  if (game.phase === "setting") {
    const setter =
      game.setter === me.sub
        ? t("hangman.you_set")
        : t("hangman.they_set", { name: game.playerNames[game.setter] });
    return `${round}. ${setter}. ${score}.`;
  }

  const turn =
    game.turn === me.sub
      ? t("ui.your_turn")
      : t("hangman.they_guess", { name: game.playerNames[game.turn] });
  return `${round}. ${turn}. ${score}.`;
}
