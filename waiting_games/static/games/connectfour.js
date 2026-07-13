// Connect Four. Click anywhere in a column to drop a disc down it.

export function create({ root, me, send }) {
  root.className = "board-c4";

  return {
    update(game) {
      const mine = game.status === "active" && !game.over && game.turn === me.sub;

      root.replaceChildren(
        ...Array.from({ length: game.cols }, (_, col) => {
          const column = document.createElement("button");
          column.className = "c4-column";

          // A column is full when its top cell is taken.
          const full = game.board[col] !== null;
          column.disabled = !mine || full;
          column.onclick = () => send({ column: col });

          for (let row = 0; row < game.rows; row++) {
            const index = row * game.cols + col;
            const disc = document.createElement("span");
            disc.className = "c4-disc";
            if (game.board[index]) disc.dataset.mark = game.board[index];
            if (index === game.last) disc.dataset.last = "true";
            column.append(disc);
          }

          return column;
        }),
      );
    },

    destroy() {},
  };
}
