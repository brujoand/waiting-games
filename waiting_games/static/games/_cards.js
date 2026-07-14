// A playing card, drawn once for every game that deals one.
//
// A card is two characters on the wire -- "TH", "AS" -- and both card games speak
// it (games/gris.py, games/idiot.py). The rank is a TRANSLATION KEY rather than
// the letter itself, because a Norwegian jack is a Kn and a Norwegian ace is an E;
// the suit is a pip, which is the same in every language there is.
//
// This module exists because Idiot was the second game to need it. Two card games
// with two rank alphabets is two rank alphabets, and the one nobody is looking at
// is the one that drifts.

import { t } from "../i18n.js";

const PIPS = { S: "♠", H: "♥", D: "♦", C: "♣" };

export function rankOf(code) {
  return code[0];
}

export function suitOf(code) {
  return code[1];
}

// A card, face up. It is a <button> even when nothing can be done with it: a
// disabled button is the one element that is inert, unfocusable and styleable all
// at once, and a card you cannot play still has to look like a card.
export function card(code, { onclick = null, disabled = false } = {}) {
  const button = document.createElement("button");
  button.className = "card";
  button.dataset.suit = suitOf(code);
  button.disabled = disabled || !onclick;

  const rank = document.createElement("b");
  rank.textContent = t(`card.rank.${rankOf(code).toLowerCase()}`);

  const pip = document.createElement("i");
  pip.textContent = PIPS[suitOf(code)];

  button.append(rank, pip);
  if (onclick) button.onclick = onclick;
  return button;
}

// A card nobody can see -- somebody's hand, or one of the three you are sitting on
// and have never looked at. There is no code to pass, because there is nothing to
// know: that is the whole point of it.
export function back({ onclick = null } = {}) {
  const button = document.createElement("button");
  button.className = "card card-back";
  button.disabled = !onclick;
  if (onclick) button.onclick = onclick;
  return button;
}
