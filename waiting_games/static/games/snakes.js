// Snakes: off the grid, and with no edges.
//
// The other one -- Snake -- is the Nokia game, and it keeps its matrix, its walls and
// its one-cell-per-tick. It works, and it works because a solo game never goes near a
// network: the browser plays it.
//
// This is the one built to be SHARED. A snake here is a PATH, drawn as one -- stroked
// polylines with round joins -- so there is nothing to slide between cells, because
// there are no cells. Which is also why this file needs no _interpolate.js: no buffer,
// no delay, no catch-up limiter, no clock estimator. Every one of those existed to
// hide the fact that a grid snake teleports a whole cell at a time, and off the grid
// there is nothing to hide.

import { t } from "../i18n.js";
import { COLOURS, canvas, hint, keys, onChange, swipe } from "./_canvas.js";
import { readout } from "./_debug.js";
import * as rules from "./snakes_rules.js";

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

// Never guess further ahead than this. Past it the connection has stopped talking, and
// a snake still gliding down a dead line is a lie that grows.
const LEAD_MAX = 0.4; // seconds

// -- a game the browser plays itself ----------------------------------------
function local(game, me, publish, finish) {
  const players = game.snakes.map((snake) => snake.player);
  const board = rules.game(game.seed, players);
  board.start();

  const seat = players.indexOf(me.sub);
  const tickMs = 1000 / rules.TICK_HZ;
  const moves = [];
  let spare = 0;
  let painted = null;
  let reported = false;

  const show = () =>
    publish?.({
      ...board.state(),
      status: board.over ? "finished" : "active",
      over: board.over,
      draw: board.over,
      winner: null,
    });
  show();

  return {
    read(now) {
      if (painted === null) painted = now;
      // A backgrounded tab hands back a gap of many seconds, and simulating twenty of
      // them in one frame is not catching up -- it is a death sentence delivered while
      // you were not looking. Cap it and let the clock slip.
      spare += Math.min(now - painted, 500);
      painted = now;

      while (spare >= tickMs && !board.over) {
        board.tick(1 / rules.TICK_HZ);
        spare -= tickMs;
        show();
      }

      if (board.over && !reported) {
        reported = true;
        finish?.({ ticks: board.ticks, moves });
      }

      return board.state();
    },

    steer(dir) {
      if (board.over || !board.steer(seat, dir)) return false;
      // run() applies a move at tick k and THEN ticks k, so these line up exactly.
      moves.push({ tick: board.ticks, dir });
      return true;
    },
  };
}

// -- somebody else's game, off the wire -------------------------------------
//
// Draw the newest state, with every head carried forward by however long ago it
// arrived. That is the whole of the netcode a continuous game needs: a snake goes
// straight far more often than it turns, so the guess is nearly always right -- and
// when it is wrong it is wrong by a fraction of a unit, which is a smudge.
//
// On a grid this same guess was worth a whole CELL, and a cell is the difference
// between alive and dead. That is the entire reason this game exists.
function carried(state, seconds) {
  const ahead = Math.min(Math.max(seconds, 0), LEAD_MAX);
  const step = state.speed * ahead;

  return {
    ...state,
    snakes: state.snakes.map((snake) => {
      if (!snake.alive || !snake.strokes.length) return snake;

      const [dx, dy] = rules.DIRECTIONS[snake.heading] ?? [0, 0];
      const strokes = snake.strokes.map((s) => s.map((p) => [p[0], p[1]]));
      const head = strokes[0][0];

      // Do NOT wrap the guess. A head carried past the seam would jump to the far side
      // of the board on a hunch, and be wrong there in a very loud way. Let it run a
      // hair off the edge instead: the next state puts it right, and a snake half a
      // body-width outside the board for 50ms is invisible.
      strokes[0][0] = [head[0] + dx * step, head[1] + dy * step];
      return { ...snake, strokes };
    }),
  };
}

export function create({ root, me, send, publish, finish }) {
  let mine = null;
  let latest = null;
  let arrived = 0;

  const board = canvas(root, (context, side) => {
    const now = performance.now();
    const state = mine
      ? mine.read(now)
      : latest && carried(latest, (now - arrived) / 1000);
    if (!state || !state.snakes.length) return;

    paint(context, side, state, me);

    if (meter) {
      const ours = state.snakes.find((snake) => snake.player === me.sub);
      if (ours && ours.strokes.length) {
        meter.frame({
          now,
          head: ours.strokes[0][0],
          path: mine ? "local" : "wire",
          delayMs: mine ? 0 : now - arrived,
          tickMs: 1000 / rules.TICK_HZ,
          dropped: 0,
          stateAge: mine ? 0 : now - arrived,
        });
      }
    }
  });
  hint(root, t("snakes.hint"));
  const meter = readout(root, board.element);

  const post = onChange(send);
  const intend = (input) => {
    // A game we run ourselves needs no wire and no dedupe: the answer to "did that turn
    // land" is yes, at once, and the rules that would refuse it refuse it here.
    if (mine) {
      if (mine.steer(input.dir)) meter?.pressed();
      return;
    }
    if (post(input)) meter?.pressed();
  };

  const stopKeys = keys(ARROWS, intend);
  const stopSwipe = swipe(board.element, intend, SWIPES);

  return {
    update(game) {
      if (game.tick === undefined || !game.snakes) return;

      if (game.clientClock) {
        if (mine === null && game.status === "active" && game.snakes.length) {
          mine = local(game, me, publish, finish);
        }
        return; // the server is not ticking this one. There is nothing to accept.
      }

      latest = game;
      arrived = performance.now();
    },

    destroy() {
      board.destroy();
      stopKeys();
      stopSwipe();
    },
  };
}

function paint(context, side, game, me) {
  const unit = side / game.board;

  context.fillStyle = "rgba(127, 140, 160, 0.10)";
  context.fillRect(0, 0, side, side);

  for (const [x, y] of game.apples) {
    context.fillStyle = "#d9534f";
    context.beginPath();
    context.arc(x * unit, y * unit, game.appleR * unit, 0, Math.PI * 2);
    context.fill();
  }

  game.snakes.forEach((snake, seat) => {
    if (!snake.strokes.length) return;

    const colour = COLOURS[seat % COLOURS.length];
    context.globalAlpha = snake.alive ? 1 : 0.25;

    // One stroke per unbroken run of body. The path is already CUT at the seam, so
    // nothing here has to think about the wrap -- a stroke that ran from x=23.9 to
    // x=0.1 would otherwise be drawn straight across the middle of the board.
    context.strokeStyle = colour;
    context.lineWidth = game.bodyR * 2 * unit;
    context.lineJoin = "round";
    // Round caps because a snake has no corners -- and because a mitred join on a
    // right angle spikes out past the body, into space the rules say is safe.
    context.lineCap = "round";

    for (const stroke of snake.strokes) {
      if (stroke.length < 2) continue;
      context.beginPath();
      context.moveTo(stroke[0][0] * unit, stroke[0][1] * unit);
      for (let i = 1; i < stroke.length; i += 1) {
        context.lineTo(stroke[i][0] * unit, stroke[i][1] * unit);
      }
      context.stroke();
    }

    const [hx, hy] = snake.strokes[0][0];
    context.fillStyle = colour;
    context.beginPath();
    context.arc(hx * unit, hy * unit, game.headR * unit, 0, Math.PI * 2);
    context.fill();

    // Ring your own head, so you can find yourself in a six-snake scrum.
    if (snake.player === me.sub && snake.alive) {
      context.strokeStyle = "#fff";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(hx * unit, hy * unit, game.headR * unit, 0, Math.PI * 2);
      context.stroke();
    }

    context.globalAlpha = 1;
  });
}

export function outcome(game, me) {
  // Solo has no winner to be: you crashed, and the engine calls that a draw because
  // there was nobody to beat. Correct on the wire, absurd in the room. You lost.
  if (game.snakes.length !== 1) return null;
  return game.snakes[0].player === me.sub ? "lose" : "none";
}

export function describe(game, me) {
  if (game.status === "waiting") return null;

  const mine = game.snakes.find((snake) => snake.player === me.sub);
  const solo = game.snakes.length === 1;

  if (game.over) {
    // A spectator has no snake, so nothing here may reach through `mine` unchecked.
    if (solo) {
      const seconds = Math.round(game.seconds * 10) / 10;
      return mine
        ? t("snakes.solo_over", { seconds, apples: mine.apples })
        : t("snakes.solo_over_watched", { seconds });
    }
    if (game.draw) return t("snakes.all_crashed");
    return game.winner === me.sub
      ? t("snakes.you_survived", { apples: mine.apples })
      : t("ui.they_won", { name: game.playerNames[game.winner] });
  }

  const you = mine
    ? mine.alive
      ? t("snakes.eaten", { apples: mine.apples })
      : t("snakes.you_crashed")
    : t("snakes.watching");

  if (solo) return you;

  const alive = game.snakes.filter((snake) => snake.alive).length;
  return t("snakes.status", { you, alive });
}
