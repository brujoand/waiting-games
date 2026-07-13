// Pong, for two to four.
//
// Your own wall is always drawn at the BOTTOM, whichever wall the server gave
// you. The board is rotated to suit you; the physics is not.
//
// Which means the controls have to be rotated too, and that is the subtle bit.
// The server's `paddle: +1` moves your paddle along its wall in world terms --
// and for two of the four walls, that rotation turns "along the wall" into
// "leftwards on your screen". Sending +1 when the player asked for right would
// then move the paddle left, which is exactly as unplayable as it sounds.
//
// So the sign is DERIVED from ROTATION rather than written down beside it. A
// second table could silently disagree with the first; this cannot.

import { t } from "../i18n.js";
import { COLOURS, canvas, halves, hint, keys, onChange } from "./_canvas.js";
import { ROTATION, screenSign } from "./_geometry.js";

// What the player asked for, on their own screen.
const LEFT = { paddle: -1 };
const RIGHT = { paddle: 1 };
const STOP = { paddle: 0 };

const STEER = {
  ArrowLeft: LEFT,
  ArrowRight: RIGHT,
  ArrowUp: LEFT,
  ArrowDown: RIGHT,
  a: LEFT,
  d: RIGHT,
};

export function create({ root, me, send }) {
  let latest = null;
  let sign = 1;

  const board = canvas(root, (context, side) => {
    if (latest) paint(context, side, latest, me);
  });
  hint(root, t("pong.hint"));

  // One deduper for every way of steering, so a finger and a key cannot end up
  // disagreeing about what the server was last told.
  const intend = onChange(send);
  const steer = (asked) => intend({ paddle: asked.paddle * sign });

  const stopKeys = keys(STEER, steer, STOP);
  // Hold a half of the board to move that way; let go to stop. That is one
  // message on press and one on release -- a phone costs the server no more than
  // a keyboard. Dragging the paddle to a position would be a message per frame,
  // and a position is cheatable in a way an intent is not.
  const stopTouch = halves(board.element, steer, {
    left: LEFT,
    right: RIGHT,
    release: STOP,
  });

  return {
    update(game) {
      latest = game;
      const mine = game.paddles.find((paddle) => paddle.player === me.sub);
      sign = mine ? screenSign(mine.wall) : 1;
    },
    destroy() {
      board.destroy();
      stopKeys();
      stopTouch();
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
  // Not before the board is dealt. This is deliberately NOT `!== "active"`:
  // a finished session's status is "finished", so that test quietly swallowed
  // every game-over line below it and left the platform's generic one to speak
  // for a game it does not understand.
  if (game.status === "waiting") return null;

  const lives = game.paddles
    .map((paddle) => {
      const name =
        paddle.player === me.sub ? t("ui.you") : game.playerNames[paddle.player];
      return `${name} ${"*".repeat(paddle.lives) || t("pong.out_short")}`;
    })
    .join(" - ");

  if (game.over) {
    if (game.draw) return `${lives}. ${t("ui.draw")}`;
    return game.winner === me.sub
      ? `${lives}. ${t("ui.you_won")}`
      : `${lives}. ${t("ui.they_won", { name: game.playerNames[game.winner] })}`;
  }

  // How to steer is mounted once, under the board -- it never changes, and this
  // line is rewritten thirty times a second. What is left here is only what is
  // genuinely live: the lives, and whether you are still in it.
  const mine = game.paddles.find((paddle) => paddle.player === me.sub);
  if (mine && !mine.out) return lives;

  return `${lives}. ${mine ? t("pong.you_are_out") : t("pong.watching")}`;
}
