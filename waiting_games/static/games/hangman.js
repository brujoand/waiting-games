// Hangman.
//
// The setter types a word; everyone else picks letters off a keyboard. The word
// only ever reaches the setter's browser -- the server masks it for everyone
// else, so there is nothing here to hide.

import { t } from "../i18n.js";
import { who } from "./_score.js";

// Keys, in the order the gallows is drawn.
const GALLOWS = [
  "head",
  "body",
  "left_arm",
  "right_arm",
  "left_leg",
  "right_leg",
  "rope",
];

export function create({ root, me, send }) {
  root.className = "board-hangman";

  return {
    update(game) {
      const setting = game.phase === "setting";
      const iAmSetter = game.setter === me.sub;

      root.replaceChildren(
        previously(game),
        setting
          ? iAmSetter
            ? wordForm(send)
            : note(t("hangman.waiting_for_setter", { name: game.playerNames[game.setter] }))
          : play(game, me, send, iAmSetter),
      );
    },

    destroy() {},
  };
}

function play(game, me, send, iAmSetter) {
  const wrap = document.createElement("div");

  const word = document.createElement("p");
  word.className = "hm-word";
  // The setter's payload carries the real word; nobody else's does.
  word.textContent = (iAmSetter ? game.word : game.revealed).split("").join(" ");
  wrap.append(word);

  const man = document.createElement("p");
  man.className = "hm-gallows";
  man.textContent = game.wrong.length
    ? t("hangman.gallows", {
        parts: GALLOWS.slice(0, game.wrong.length)
          .map((part) => t(`hangman.part.${part}`))
          .join(", "),
        wrong: game.wrong.length,
        max: game.maxWrong,
      })
    : t("hangman.gallows_empty", { max: game.maxWrong });
  wrap.append(man);

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
  if (game.status !== "active") return null;

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
