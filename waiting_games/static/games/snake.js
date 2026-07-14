// Snake.
//
// update() does NO dom work -- it just stashes the latest frame. The rAF loop
// paints from it. That is what keeps a 6 Hz state stream from stuttering a
// 60 Hz screen, and what stops the canvas being rebuilt on every push.

import { t } from "../i18n.js";
import { COLOURS, canvas, hint, keys, onChange, swipe } from "./_canvas.js";
import { readout } from "./_debug.js";
import { ahead, at, timeline } from "./_interpolate.js";

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
  // Snake moves ONE WHOLE CELL per tick. Drawn at the cell it is on, it therefore
  // teleports a full grid square six times a second, and no amount of repainting
  // at 60 fps helps: the thing being painted only changes 6 times a second. That
  // is the choppiness, and it is not a dropped-frame problem -- it is what the
  // game looks like when you draw it honestly.
  //
  // So slide it between cells. That used to mean drawing the world a tick in the
  // past, because a slide needs the cell it is going TO and only the server knew
  // it -- and a tick in the past is a whole CELL in the past, at any tick rate.
  // Now the server sends the cell each snake is about to take (`next`), so the
  // slide is drawn while the move is happening rather than after it happened.
  // Nothing here is a guess, and nothing is a cell behind.
  let clock = null;

  const board = canvas(root, (context, side) => {
    const now = performance.now();
    const frame = clock?.read(now);
    if (!frame) return;

    paint(context, side, frame, me);

    // Nothing unless the page was loaded with ?debug. It reads the head off the
    // very cells that were just painted, so what it reports is what is on the
    // screen and not a second opinion about it.
    if (meter) {
      const mine = frame.state.snakes.find((snake) => snake.player === me.sub);
      const stats = clock.debug(now);
      if (mine) {
        meter.frame({
          now,
          head: where(frame, mine, 0),
          path: frame.ahead ? "live" : "catching up",
          delayMs: stats.delayTicks * stats.tickMs,
          tickMs: stats.tickMs,
          dropped: stats.dropped,
          stateAge: stats.stateAge,
        });
      }
    }
  });
  hint(root, t("snake.hint"));

  // After canvas(), which replaces the root's children -- same reason hint() is.
  // The paint loop above closes over this, and only ever runs from a
  // requestAnimationFrame, which is to say after this line.
  const meter = readout(root);

  // One deduper for every way of steering. A swipe, a key and a button are all
  // the same intent, and if each kept its own idea of what the server was last
  // told they would disagree the moment somebody used two of them.
  const post = onChange(send);
  const intend = (input) => {
    meter?.pressed(); // start the stopwatch: key now, turn on some later frame
    post(input);
  };
  const stopKeys = keys(ARROWS, intend);
  const stopSwipe = swipe(board.element, intend, SWIPES);

  return {
    update(game) {
      // Before the clock starts there is nothing to animate -- and nothing to
      // animate BETWEEN, either: a game sitting in the lobby has no ticks.
      if (game.tick === undefined) return;
      if (clock === null) clock = timeline(game.tickHz);

      // The tick index is what makes a state a MOMENT rather than just the
      // newest thing we have. A push that carries no new tick -- somebody
      // connecting, somebody leaving -- is dropped on the floor by accept(),
      // which is why opening the page no longer stutters everyone else's snake.
      clock.accept(game, game.tick, performance.now());
    },
    destroy() {
      board.destroy();
      stopKeys();
      stopSwipe();
    },
  };
}

// Forwards into the move the server says is coming, or -- when a state went
// missing and we are behind -- backwards down the body towards the state we did
// get. A dead snake is not going anywhere at all: it dies WITHOUT moving, so its
// body still reads as a perfectly good path, and walking it in either direction
// would drag the corpse off the cell it died on. Both walks refuse.
//
// The readout calls this too, on the same frame, so the speed it reports is the
// speed of the snake that was actually drawn rather than a second opinion.
function where(frame, snake, index) {
  return frame.ahead
    ? ahead(snake, index, frame.alpha)
    : at(snake, index, frame.alpha, snake.alive ? frame.span : 0);
}

function paint(context, side, frame, me) {
  const game = frame.state;
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

    snake.cells.forEach((_, index) => {
      const [x, y] = where(frame, snake, index);
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
      const [hx, hy] = where(frame, snake, 0);
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
  // Not before the board is dealt. This is deliberately NOT `!== "active"`:
  // a finished session's status is "finished", so that test quietly swallowed
  // every game-over line below it and left the platform's generic one to speak
  // for a game it does not understand.
  if (game.status === "waiting") return null;

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
  // once per tick, and a status line that rewrites itself several times a second
  // is one nobody can actually read -- the digits just flicker. The elapsed time
  // IS the score in solo, so it is reported once, when the run ends.
  const you = mine
    ? mine.alive
      ? t("snake.length", { length: mine.length })
      : t("snake.you_crashed")
    : t("snake.watching");

  if (solo) return you;

  const alive = game.snakes.filter((snake) => snake.alive).length;
  return t("snake.status", { you, alive });
}
