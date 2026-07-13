// Dots and boxes.
//
// Laid out as one (2n+1) x (2n+1) grid, so the dots, the edges between them and
// the boxes they enclose all fall out of the row/column parity:
//
//   even/even -> a dot        even/odd -> a horizontal edge
//   odd/even  -> a vertical edge        odd/odd  -> a box

import { scoreline } from "./_score.js";

const COLOURS = ["a", "b", "c", "d"]; // one per seat, styled in CSS

export function create({ root, me, send }) {
  root.className = "board-dab";

  return {
    update(game) {
      const n = game.size;
      const dots = n + 1;
      const span = 2 * n + 1;
      const mine = game.status === "active" && !game.over && game.turn === me.sub;

      root.style.setProperty("--span", span);

      const cells = [];
      for (let r = 0; r < span; r++) {
        for (let c = 0; c < span; c++) {
          const evenRow = r % 2 === 0;
          const evenCol = c % 2 === 0;

          if (evenRow && evenCol) {
            cells.push(node("span", "dab-dot"));
          } else if (evenRow) {
            const index = (r / 2) * n + (c - 1) / 2;
            cells.push(edge(game, "h", index, mine, send));
          } else if (evenCol) {
            const index = ((r - 1) / 2) * dots + c / 2;
            cells.push(edge(game, "v", index, mine, send));
          } else {
            const owner = game.boxes[((r - 1) / 2) * n + (c - 1) / 2];
            const box = node("span", "dab-box");
            if (owner !== null) box.dataset.owner = COLOURS[owner];
            cells.push(box);
          }
        }
      }

      root.replaceChildren(...cells);
    },

    destroy() {},
  };
}

function node(tag, className) {
  const element = document.createElement(tag);
  element.className = className;
  return element;
}

function edge(game, kind, index, mine, send) {
  const drawn = (kind === "h" ? game.horizontal : game.vertical)[index];
  const button = node("button", `dab-edge dab-${kind}`);
  button.disabled = drawn || !mine;
  if (drawn) button.dataset.drawn = "true";
  button.onclick = () => send({ kind, index });
  return button;
}

export function describe(game, me) {
  return scoreline(game, me);
}
