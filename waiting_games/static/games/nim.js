// Nim. Click a match to take it and everything to its right in that pile.

import { t } from "../i18n.js";

export function create({ root, me, send }) {
  root.className = "board-nim";

  return {
    update(game) {
      const mine = game.status === "active" && !game.over && game.turn === me.sub;

      root.replaceChildren(
        ...game.piles.map((count, pile) => {
          const row = document.createElement("div");
          row.className = "nim-pile";

          for (let i = 0; i < count; i++) {
            const match = document.createElement("button");
            match.className = "nim-match";
            match.disabled = !mine;
            // Taking the i-th match takes it and every one after it, which is
            // how you pick "how many" without a number input.
            match.onclick = () => send({ pile, count: count - i });
            match.title = t("nim.take", { count: count - i });
            row.append(match);
          }

          if (count === 0) {
            row.append(
              Object.assign(document.createElement("span"), {
                className: "nim-empty",
                textContent: t("nim.empty"),
              }),
            );
          }

          return row;
        }),
      );
    },

    destroy() {},
  };
}

export function describe(game, me) {
  if (game.over && !game.draw) {
    return game.winner === me.sub
      ? t("nim.you_took_the_last")
      : t("nim.they_took_the_last", { name: game.playerNames[game.winner] });
  }
  return null; // the platform's default is fine otherwise
}
