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
  //
  // Thinner than a paddle, and that is not a style choice: the ball turns around
  // AT a bare wall and at the FACE of a paddle, so a wall drawn as thick as a
  // paddle would be claiming a slab of board that nothing bounces off.
  context.fillStyle = "rgba(127, 140, 160, 0.5)";
  const wallThick = side * 0.02;
  for (const wall of game.solid) {
    if (wall === "left") context.fillRect(0, 0, wallThick, side);
    if (wall === "right") context.fillRect(side - wallThick, 0, wallThick, side);
    if (wall === "top") context.fillRect(0, 0, side, wallThick);
    if (wall === "bottom") context.fillRect(0, side - wallThick, side, wallThick);
  }

  // Paddles sit ON their wall, and they are exactly as thick as the server says
  // they are -- `paddleThick` is the slab the ball really turns around at, not a
  // decoration. Drawing them any other size would be a lie about where contact
  // happens, and the ball is big enough now that you would see it.
  game.paddles.forEach((paddle, seat) => {
    if (paddle.out) return;

    const [x, y, w, h] = slab(paddle, game.paddleHalf, game.paddleThick, side);
    const colour = COLOURS[seat % COLOURS.length];

    // Held: the paddle glows while its player is leaning on the controls.
    //
    // On a phone you steer by holding a HALF OF THE BOARD -- your finger is
    // nowhere near the paddle -- so without this there is nothing on screen that
    // says the press landed. A paddle already jammed against the end of its wall
    // makes it worse: it is being held, it cannot move, and a board that shows
    // nothing at all looks like one that has stopped listening.
    //
    // A halo in the paddle's OWN colour, and not the obvious lighter fill. This
    // board has a light theme and a dark one, and white-over-colour brightens on
    // one and washes out on the other -- on the light theme a held paddle went
    // PALER than an idle one, which is exactly backwards for "the game can hear
    // you". A glow grows the paddle's presence on either.
    context.save();
    if (paddle.held) {
      context.shadowColor = colour;
      context.shadowBlur = Math.min(w, h) * 1.4; // the slab's thickness, softened
    }
    context.fillStyle = colour;
    context.fillRect(x, y, w, h);
    if (paddle.held) context.fillRect(x, y, w, h); // twice: one pass is a rumour
    context.restore();
  });

  ball(context, side, game);

  context.restore();
}

// Where a paddle's slab lies, in screen pixels, on whichever wall it defends.
//
// One table rather than four fill calls: the paddle is drawn twice (colour, then
// the held highlight over it), and two copies of the same if-chain is exactly how
// a highlight ends up half a pixel off the thing it is highlighting.
function slab(paddle, half, deep, side) {
  const length = half * 2 * side;
  const thick = deep * side;
  const start = paddle.position * side - length / 2;

  if (paddle.wall === "left") return [0, start, thick, length];
  if (paddle.wall === "right") return [side - thick, start, thick, length];
  if (paddle.wall === "top") return [start, 0, length, thick];
  return [start, side - thick, length, thick];
}

function ball(context, side, game) {
  const [bx, by] = game.ball;
  const radius = game.radius * side;

  // A glow, and then the ball on top of it. The ball is the one thing on this
  // board you have to track, it is the smallest thing on it, and it was a flat
  // near-white circle on a near-white board -- players simply lost it. The halo
  // is what makes it findable in peripheral vision, which is where you are
  // actually looking while your hands are busy with the paddle.
  context.save();
  context.shadowColor = "rgba(255, 209, 102, 0.95)";
  context.shadowBlur = radius * 1.8;
  context.fillStyle = "#ffd166";

  context.beginPath();
  context.arc(bx * side, by * side, radius, 0, Math.PI * 2);
  // Twice: a single pass lays down one faint blur, and the point of the halo is
  // to be seen without being looked at.
  context.fill();
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
