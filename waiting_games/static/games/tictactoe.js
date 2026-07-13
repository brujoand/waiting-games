// Tic-tac-toe.
//
// The renderer contract: create() is called once when the game screen opens and
// owns `root` until destroy(). update() runs on every state push. A DOM game
// like this one rebuilds the board in update() and has nothing to tear down; a
// canvas game paints from its own rAF loop and cleans it up in destroy().

export function create({ root, me, send }) {
  root.className = "grid-3";

  return {
    update(game) {
      const mine = game.status === "active" && !game.over && game.turn === me.sub;

      root.replaceChildren(
        ...game.board.map((mark, cell) => {
          const button = document.createElement("button");
          button.className = "cell";
          button.textContent = mark ?? "";
          button.disabled = !mine || mark !== null;
          button.onclick = () => send({ cell });
          return button;
        }),
      );
    },

    destroy() {},
  };
}
