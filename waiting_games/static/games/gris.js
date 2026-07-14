// Gris.
//
// Four cards, one of which you pass to the left; everybody passes at the same
// time. Get four of a kind and touch your nose. The last player to notice takes a
// letter, and four letters spell GRIS.
//
// The whole game is watching the other players, so THEY are the board: the hand
// is small and quiet at the bottom, and the table -- who has passed, whose nose is
// up, how close each of them is to the word -- is the thing on screen.

import { t } from "../i18n.js";
import { who } from "./_score.js";

const PIPS = { S: "♠", H: "♥", D: "♦", C: "♣" };

export function create({ root, me, send }) {
  root.className = "board-gris";

  return {
    update(game) {
      // My own view carries `hand`; a spectator's does not, and that is the only
      // thing that distinguishes them here.
      const seated = Array.isArray(game.hand);
      const racing = game.touched.length > 0;

      root.replaceChildren(
        ...[
          previously(game, me),
          table(game, me),
          seated ? hand(game, send, racing) : null,
          seated ? nose(game, me, send, racing) : null,
        ].filter(Boolean),
      );
    },

    destroy() {},
  };
}

// -- the table: everyone else, which is where the game actually is -------------

function table(game, me) {
  const list = document.createElement("ul");
  list.className = "gris-table";

  // `counts` is emitted in seat order, so this is the table as it sits. The
  // platform's `players` is a list of NAMES, which cannot be matched back to a sub.
  for (const sub of Object.keys(game.counts)) {
    list.append(player(game, me, sub));
  }
  return list;
}

function player(game, me, sub) {
  const row = document.createElement("li");
  row.className = "gris-player";
  if (sub === me.sub) row.dataset.me = "true";

  const touched = game.touched.includes(sub);
  if (touched) row.dataset.touched = "true";
  if (game.passed.includes(sub)) row.dataset.passed = "true";
  if (game.pig === sub) row.dataset.pig = "true";

  const name = document.createElement("span");
  name.className = "gris-name";
  name.textContent = who(game, me, sub);

  const word = document.createElement("span");
  word.className = "gris-word";
  // The letters they have earned, lit; the ones they have not, still there and
  // dim. Seeing how much room is left is the point of showing it at all.
  t("gris.word")
    .split("")
    .forEach((letter, index) => {
      const slot = document.createElement("i");
      slot.textContent = letter;
      if (index < game.counts[sub]) slot.dataset.on = "true";
      word.append(slot);
    });

  const chip = document.createElement("span");
  chip.className = "gris-chip";
  chip.textContent = touched
    ? t("gris.chip.nose")
    : game.passed.includes(sub)
      ? t("gris.chip.ready")
      : t("gris.chip.thinking");

  row.append(name, word, chip);
  return row;
}

// -- your hand ---------------------------------------------------------------

function hand(game, send, racing) {
  const rack = document.createElement("div");
  rack.className = "gris-hand";

  for (const card of game.hand) {
    const button = document.createElement("button");
    button.className = "gris-card";
    button.dataset.suit = card[1];
    // Once a nose is up the deal is over: there is nothing left to do but race.
    button.disabled = game.over || racing || game.chosen !== null;
    if (card === game.chosen) button.dataset.chosen = "true";

    const rank = document.createElement("b");
    rank.textContent = t(`gris.rank.${card[0].toLowerCase()}`);
    const pip = document.createElement("i");
    pip.textContent = PIPS[card[1]];

    button.append(rank, pip);
    button.onclick = () => send({ card });
    rack.append(button);
  }
  return rack;
}

// -- the nose ----------------------------------------------------------------

function nose(game, me, send, racing) {
  const wrap = document.createElement("div");
  wrap.className = "gris-nose";

  const mine = game.touched.includes(me.sub);

  const button = document.createElement("button");
  button.className = "primary gris-touch";
  button.textContent = t("gris.touch");
  button.disabled = game.over || mine;
  // Armed means SAFE to press, not enabled: pressing it with nothing, before
  // anyone else has, is a false start and costs a letter. That is the rule that
  // stops the button being hammered every round, so the button has to say so
  // rather than quietly punish you.
  button.dataset.armed = String(game.four || racing);
  button.onclick = () => send({ touch: true });

  const hint = document.createElement("p");
  hint.className = "gris-hint";
  hint.textContent = mine
    ? t("gris.you_are_safe")
    : racing
      ? t("gris.noses_are_up")
      : game.four
        ? t("gris.four_of_a_kind")
        : t("gris.risky");

  wrap.append(button, hint);
  return wrap;
}

// -- what just happened ------------------------------------------------------

function previously(game, me) {
  if (!game.last) return null;

  const note = document.createElement("p");
  note.className = "gris-note";
  const name = who(game, me, game.last.loser);
  note.textContent =
    game.last.reason === "false_start"
      ? t("gris.last.false_start", { name })
      : t("gris.last.slow", { name, caught: who(game, me, game.last.caught) });
  return note;
}

export function describe(game, me) {
  // Deliberately not `!== "active"`: a finished session's status is "finished",
  // and that test would swallow the game-over line below.
  if (game.status === "waiting") return null;

  const deal = t("gris.deal", { round: game.round });

  if (game.over) {
    return game.pig === me.sub
      ? `${deal}. ${t("gris.you_are_the_pig")}`
      : `${deal}. ${t("gris.the_pig", { name: game.playerNames[game.pig] })}`;
  }

  if (game.touched.length) return `${deal}. ${t("gris.noses_are_up")}`;
  if (game.four) return `${deal}. ${t("gris.four_of_a_kind")}`;
  // A seated player who has not chosen yet has exactly one thing to do. (A
  // spectator has no `chosen` at all, so they drop through to the roll-call.)
  if (game.chosen === null) return `${deal}. ${t("gris.pass_a_card")}`;

  const waiting = Object.keys(game.counts)
    .filter((sub) => !game.passed.includes(sub))
    .map((sub) => who(game, me, sub));
  return `${deal}. ${t("gris.waiting_for", { names: waiting.join(", ") })}`;
}

export function outcome(game, me) {
  // The platform reads `winner`, and by fewest-letters a game where the survivors
  // came out level is a DRAW -- which is honest for them and absurd for the pig,
  // who would get the draw chime for spelling the word. Everyone else's verdict
  // the platform already has right, so say nothing about them.
  if (game.over && game.pig === me.sub) return "lose";
  return null;
}
