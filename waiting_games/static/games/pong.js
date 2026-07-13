// Pong, for two to four.
//
// Your own wall is always drawn at the BOTTOM, whichever wall the server gave
// you -- so left/right always means left/right to your hands. The board is
// rotated to suit you; the physics is not.

import { t } from "../i18n.js";
import { COLOURS, canvas, keys } from "./_canvas.js";

const STEER = {
  ArrowLeft: { paddle: -1 },
  ArrowRight: { paddle: 1 },
  ArrowUp: { paddle: -1 },
  ArrowDown: { paddle: 1 },
  a: { paddle: -1 },
  d: { paddle: 1 },
};
const STOP = { paddle: 0 };

// How far to turn the board so that `wall` ends up at the bottom.
const ROTATION = { bottom: 0, left: -Math.PI / 2, top: Math.PI, right: Math.PI / 2 };

export function create({ root, me, send }) {
  let latest = null;

  const stopPainting = canvas(root, (context, side) => {
    if (latest) paint(context, side, latest, me);
  });
  const stopListening = keys(STEER, send, STOP);

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
  const mine = game.paddles.find((paddle) => paddle.player === me.sub);
  const turn = ROTATION[mine ? mine.wall : "bottom"];

  context.save();
  context.translate(side / 2, side / 2);
  context.rotate(turn);
  context.translate(-side / 2, -side / 2);

  context.fillStyle = "rgba(127, 140, 160, 0.10)";
  context.fillRect(0, 0, side, side);

  // A wall nobody defends is solid, and the ball comes back off it. Draw it, or
  // it looks like a bug.
  context.fillStyle = "rgba(127, 140, 160, 0.5)";
  const thick = side * 0.02;
  for (const wall of game.solid) {
    if (wall === "left") context.fillRect(0, 0, thick, side);
    if (wall === "right") context.fillRect(side - thick, 0, thick, side);
    if (wall === "top") context.fillRect(0, 0, side, thick);
    if (wall === "bottom") context.fillRect(0, side - thick, side, thick);
  }

  // Paddles sit ON their wall, because that is exactly where the server bounces
  // the ball off them. Drawing them inset would look tidier and would be a lie:
  // the ball would visibly turn around in the gap and never touch the paddle.
  game.paddles.forEach((paddle, seat) => {
    if (paddle.out) return;

    context.fillStyle = COLOURS[seat % COLOURS.length];
    const length = game.paddleHalf * 2 * side;
    const along = paddle.position * side;

    if (paddle.wall === "left") {
      context.fillRect(0, along - length / 2, thick, length);
    } else if (paddle.wall === "right") {
      context.fillRect(side - thick, along - length / 2, thick, length);
    } else if (paddle.wall === "top") {
      context.fillRect(along - length / 2, 0, length, thick);
    } else {
      context.fillRect(along - length / 2, side - thick, length, thick);
    }
  });

  const [bx, by] = game.ball;
  context.fillStyle = "#e8eaed";
  context.beginPath();
  context.arc(bx * side, by * side, game.radius * side, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

export function describe(game, me) {
  if (game.status !== "active") return null;

  const lives = game.paddles
    .map((paddle) => {
      const name =
        paddle.player === me.sub ? t("ui.you") : game.playerNames[paddle.player];
      return `${name} ${"*".repeat(paddle.lives) || t("pong.out_short")}`;
    })
    .join(" - ");

  if (game.over) {
    if (game.draw) return `${lives}. Draw.`;
    return game.winner === me.sub
      ? `${lives}. You won!`
      : `${lives}. ${game.playerNames[game.winner]} won.`;
  }

  const mine = game.paddles.find((paddle) => paddle.player === me.sub);
  const hint = mine
    ? mine.out
      ? t("pong.you_are_out")
      : t("pong.hint")
    : t("pong.watching");

  return `${lives}. ${hint}`;
}
