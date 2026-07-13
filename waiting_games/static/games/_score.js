// The status line for a game won on points: "You 7 - Kari 5. Your turn."
//
// `game.counts` is keyed by player id, not by seat, so nothing here depends on
// the platform's playerNames dict happening to be ordered by seat.

export function scoreline(game, me) {
  const score = Object.entries(game.counts)
    .map(([sub, count]) => `${sub === me.sub ? "You" : game.playerNames[sub]} ${count}`)
    .join(" - ");

  if (game.over) {
    if (game.draw) return `${score}. Draw.`;
    const who = game.winner === me.sub ? "You" : game.playerNames[game.winner];
    return `${score}. ${who} won.`;
  }

  const turn =
    game.turn === me.sub ? "Your turn" : `${game.playerNames[game.turn]}'s turn`;
  return `${score}. ${turn}.`;
}
