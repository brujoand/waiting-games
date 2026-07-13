// Snake.
//
// update() does NO dom work -- it just stashes the latest frame. The rAF loop
// paints from it. That is what keeps an 8 Hz state stream from stuttering a
// 60 Hz screen, and what stops the canvas being rebuilt on every push.

import { t } from "../i18n.js";
import { COLOURS, canvas, hint, keys, onChange, swipe } from "./_canvas.js";

// Swipe on a phone; the arrow keys (or WASD) on anything with them.
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

export function create({ root, me, send }) {
  let latest = null;

  const board = canvas(root, (context, side) => {
    if (latest) paint(context, side, latest, me);
  });
  hint(root, t("snake.hint"));

  // One deduper for every way of steering. A swipe, a key and a button are all
  // the same intent, and if each kept its own idea of what the server was last
  // told they would disagree the moment somebody used two of them.
  const intend = onChange(send);
  const stopKeys = keys(ARROWS, intend);
  const stopSwipe = swipe(board.element, intend, SWIPES);

  return {
    update(game) {
      latest = game;
    },
    destroy() {
      board.destroy();
      stopKeys();
      stopSwipe();
    },
  };
}

function paint(context, side, game, me) {
  const cell = side / game.width;

  context.fillStyle = "rgba(127, 140, 160, 0.10)";
  context.fillRect(0, 0, side, cell * game.height);

  for (const [x, y] of game.apples) {
    context.fillStyle = "#d9534f";
    context.beginPath();
    context.arc((x + 0.5) * cell, (y + 0.5) * cell, cell * 0.34, 0, Math.PI * 2);
    context.fill();
  }

  game.snakes.forEach((snake, seat) => {
    context.fillStyle = COLOURS[seat % COLOURS.length];
    context.globalAlpha = snake.alive ? 1 : 0.25;

    snake.cells.forEach(([x, y], index) => {
      const inset = index === 0 ? 0 : cell * 0.08; // the head is a little bigger
      context.fillRect(
        x * cell + inset,
        y * cell + inset,
        cell - inset * 2,
        cell - inset * 2,
      );
    });

    // Ring your own head so you can find yourself in a six-snake scrum.
    if (snake.player === me.sub && snake.alive) {
      const [hx, hy] = snake.cells[0];
      context.strokeStyle = "#fff";
      context.lineWidth = 2;
      context.strokeRect(hx * cell + 1, hy * cell + 1, cell - 2, cell - 2);
    }

    context.globalAlpha = 1;
  });
}

export function outcome(game, me) {
  // Solo has no winner to be. The run ends when you crash, and the engine reports
  // that as a DRAW -- Result.draw() -- because there was nobody to beat. Which is
  // correct on the wire and would be absurd in the room: the platform's rule
  // would play a neutral, that-was-close chime at somebody who just died.
  //
  // You crashed. It is a loss. Have the trombone.
  if (game.snakes.length !== 1) return null; // a race: the platform is right

  return game.snakes[0].player === me.sub ? "lose" : "none";
}

export function describe(game, me) {
  if (game.status !== "active") return null;

  const mine = game.snakes.find((snake) => snake.player === me.sub);
  const solo = game.snakes.length === 1;

  if (game.over) {
    // A spectator has no snake of their own, so nothing on this path may reach
    // through `mine` without checking. Watching somebody else's solo run used to
    // throw here and blank the whole status line.
    if (solo) {
      return mine
        ? t("snake.solo_over", { seconds: game.seconds, length: mine.length })
        : t("snake.solo_over_watched", { seconds: game.seconds });
    }
    if (game.draw) return t("snake.all_crashed");
    return game.winner === me.sub
      ? t("snake.you_survived", { length: mine.length })
      : t("ui.they_won", { name: game.playerNames[game.winner] });
  }

  // No clock on this line. The server streams `seconds` to one decimal place,
  // eight times a second, and a status line that rewrites itself at 8 Hz is one
  // nobody can actually read -- the digits just flicker. The elapsed time IS the
  // score in solo, so it is reported once, when the run ends.
  const you = mine
    ? mine.alive
      ? t("snake.length", { length: mine.length })
      : t("snake.you_crashed")
    : t("snake.watching");

  if (solo) return you;

  const alive = game.snakes.filter((snake) => snake.alive).length;
  return t("snake.status", { you, alive });
}
