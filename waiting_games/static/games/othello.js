// Othello. Legal moves are dotted; the server tells us which they are.

import { scoreline } from "./_score.js";

export function create({ root, me, send }) {
  root.className = "board-othello";

  return {
    update(game) {
      const mine = game.status === "active" && !game.over && game.turn === me.sub;
      const legal = new Set(mine ? game.legal : []);

      root.style.setProperty("--size", game.size);
      root.replaceChildren(
        ...game.board.map((mark, cell) => {
          const square = document.createElement("button");
          square.className = "othello-square";
          square.disabled = !legal.has(cell);
          if (mark) square.dataset.mark = mark;
          if (legal.has(cell)) square.dataset.legal = "true";
          square.onclick = () => send({ cell });
          return square;
        }),
      );
    },

    destroy() {},
  };
}

export function describe(game, me) {
  // The engine skips a player with no legal move, so the turn can come straight
  // back to you -- the score line is what makes that legible rather than looking
  // like the board ignored your opponent.
  return scoreline(game, me);
}
