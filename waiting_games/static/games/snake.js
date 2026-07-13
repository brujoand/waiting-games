// Snake.
//
// update() does NO dom work -- it just stashes the latest frame. The rAF loop
// paints from it. That is what keeps an 8 Hz state stream from stuttering a
// 60 Hz screen, and what stops the canvas being rebuilt on every push.

import { COLOURS, canvas, keys } from "./_canvas.js";

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

  const stopPainting = canvas(root, (context, side) => {
    if (latest) paint(context, side, latest, me);
  });
  const stopListening = keys(ARROWS, send);

  return {
    update(game) {
      latest = game;
    },
    destroy() {
      stopPainting();
      stopListening();
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

export function describe(game, me) {
  if (game.status !== "active") return null;

  const mine = game.snakes.find((snake) => snake.player === me.sub);
  const solo = game.snakes.length === 1;

  if (game.over) {
    if (solo) {
      return `You survived ${game.seconds} seconds and grew to ${mine.length} long.`;
    }
    if (game.draw) return "Everyone crashed. Draw.";
    return game.winner === me.sub
      ? `You are the last snake alive! Length ${mine.length}.`
      : `${game.playerNames[game.winner]} won.`;
  }

  const alive = game.snakes.filter((snake) => snake.alive).length;
  const you = mine
    ? mine.alive
      ? `Length ${mine.length}`
      : "You crashed"
    : "You are watching";

  return solo
    ? `${you}. ${game.seconds} seconds.`
    : `${you}. ${alive} snakes alive. Use the arrow keys.`;
}
