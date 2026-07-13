// The status line for a game won on points: "You 7 - Kari 5. Your turn."
//
// `game.counts` is keyed by player id, not by seat, so nothing here depends on
// the platform's playerNames dict happening to be ordered by seat.

import { t } from "../i18n.js";

export function who(game, me, sub) {
  return sub === me.sub ? t("ui.you") : game.playerNames[sub];
}

export function scoreline(game, me) {
  const score = Object.entries(game.counts)
    .map(([sub, count]) => `${who(game, me, sub)} ${count}`)
    .join(" - ");

  if (game.over) {
    if (game.draw) return `${score}. ${t("ui.draw")}`;
    return game.winner === me.sub
      ? `${score}. ${t("ui.you_won")}`
      : `${score}. ${t("ui.they_won", { name: game.playerNames[game.winner] })}`;
  }

  const turn =
    game.turn === me.sub
      ? t("ui.your_turn")
      : t("ui.their_turn", { name: game.playerNames[game.turn] });
  return `${score}. ${turn}.`;
}
