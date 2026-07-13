// Tic tac toe board renderer.
//
// A game renderer gets the board element, the server's game state, the local
// player, and a `send` callback. It owns nothing else.

export function render(root, game, me, send) {
  const myTurn = !game.over && game.turn === me.sub && game.status === "active";

  root.className = "grid-3";
  root.replaceChildren(
    ...game.board.map((mark, cell) => {
      const button = document.createElement("button");
      button.className = "cell";
      button.textContent = mark ?? "";
      button.disabled = !myTurn || mark !== null;
      button.onclick = () => send({ cell });
      return button;
    }),
  );
}
