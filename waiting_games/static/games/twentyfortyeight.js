// 2048.
//
// A dom game, not a canvas one -- the board only changes when you move it. But it
// steers like the real-time games do, so it borrows their keyboard and swipe
// helpers rather than growing a second, subtly different copy of the phone logic.
//
// What it does NOT borrow is onChange(): that helper sends an intent only when it
// CHANGES, which is right for a snake that is already heading left and wrong here,
// where sliding left twice is two moves.

import { t } from "../i18n.js";
import { keys, swipe } from "./_canvas.js";

const SWIPES = {
  up: { dir: "up" },
  down: { dir: "down" },
  left: { dir: "left" },
  right: { dir: "right" },
};

const ARROWS = {
  ArrowUp: { dir: "up" },
  ArrowDown: { dir: "down" },
  ArrowLeft: { dir: "left" },
  ArrowRight: { dir: "right" },
  w: { dir: "up" },
  s: { dir: "down" },
  a: { dir: "left" },
  d: { dir: "right" },
};

export function create({ root, send }) {
  root.className = "board-2048";

  const cells = [];
  const grid = document.createElement("div");
  grid.className = "t48-grid";
  root.replaceChildren(grid);

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = t("twentyfortyeight.hint");
  root.append(note);

  // A spectator may not move the board, but the server would refuse them anyway
  // (move.not_seated), so there is nothing to gate here -- the listeners bind
  // once and the platform's rules do the rest.
  const stopKeys = keys(ARROWS, send);
  const stopSwipe = swipe(grid, send, SWIPES);

  return {
    update(game) {
      if (game.status === "waiting") return; // no board dealt yet

      // Built once, then only the tiles' text and value change. Replacing the
      // children every push would restart the pop animation on every tile.
      if (cells.length !== game.tiles.length) {
        grid.style.setProperty("--size", game.size);
        grid.replaceChildren();
        cells.length = 0;
        for (let index = 0; index < game.tiles.length; index += 1) {
          const cell = document.createElement("div");
          cell.className = "t48-tile";
          grid.append(cell);
          cells.push(cell);
        }
      }

      game.tiles.forEach((value, index) => {
        const cell = cells[index];
        const previous = cell.dataset.value;
        const next = value ? String(value) : "";

        if (previous === next) return;
        cell.textContent = next;
        // Blank cells carry no data-value at all, so the css can style "empty"
        // without an attribute selector for the number zero.
        if (value) cell.dataset.value = next;
        else delete cell.dataset.value;

        // Land the new number with a little pop. Restarted by hand, because the
        // class is already there whenever a tile changes twice in a row.
        if (value) {
          cell.classList.remove("t48-pop");
          void cell.offsetWidth;
          cell.classList.add("t48-pop");
        }
      });
    },

    destroy() {
      stopKeys();
      stopSwipe();
    },
  };
}

export function outcome(game) {
  // A solo run has nobody to lose TO, so the engine ends a jammed board as a DRAW
  // -- see twentyfortyeight.py. On the wire that is the only honest answer; in the
  // room it would mean a neutral, never-mind chime for a run that just died.
  //
  // A win still is a win: leave that one to the platform.
  if (game.seat === null || game.seat === undefined) return null; // a spectator
  return game.draw ? "lose" : null;
}

export function describe(game, me) {
  // Not before the board is dealt. This is deliberately NOT `!== "active"`:
  // a finished session's status is "finished", so that test quietly swallowed
  // every game-over line below it and left the platform's generic one to speak
  // for a game it does not understand.
  if (game.status === "waiting") return null;

  // Seat 0 is a real seat and it is also falsy, so this cannot be `!game.seat`.
  const playing = game.seat !== null && game.seat !== undefined;

  if (game.over) {
    if (game.winner === me.sub) {
      return t("twentyfortyeight.you_made_it", {
        target: game.target,
        score: game.score,
      });
    }
    if (!playing) return t("twentyfortyeight.run_over_watched", { score: game.score });
    return t("twentyfortyeight.stuck", { score: game.score });
  }

  return playing
    ? t("twentyfortyeight.score", { score: game.score })
    : t("twentyfortyeight.watching", { score: game.score });
}
