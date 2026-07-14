// Snake, off the grid.
//
// The snake is a PATH now, not a row of squares, so it is drawn as one: a thick
// stroked polyline with round joins, and a head on the front. Nothing here has to
// slide anything between cells, because there are no cells to be between.
//
// That deleted _interpolate.js entirely -- a file that existed only to hide the fact
// that a grid snake teleports a whole cell at a time, and which grew a buffer, a
// delay, a catch-up limiter and a clock estimator trying to do it. All of it was the
// cost of the grid. None of it is needed now.
//
// Two sources of truth, one renderer:
//
//   SOLO   the browser plays the game (see snake_rules.js). The state comes from our
//          own simulation, and no packet is anywhere near the render loop.
//   SHARED the server plays it. The state comes off the wire, and we extrapolate the
//          heads forward from it -- which off the grid is a few pixels of guess, not
//          a whole cell of life or death.

import { t } from "../i18n.js";
import { COLOURS, canvas, hint, keys, onChange, swipe } from "./_canvas.js";
import { readout } from "./_debug.js";
import * as rules from "./snake_rules.js";

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

// Never guess further ahead than this. Past it the connection has stopped talking and
// a snake still gliding down a dead line is a lie that grows.
const LEAD_MAX = 0.4; // seconds

// -- a game the browser plays itself ----------------------------------------
//
// A phone cannot be SHOWN this game over a radio. Measured on a real one, mid-game:
// the gaps between state arrivals ran a median of 168ms, a 90th percentile of 333ms
// and a worst of 2439ms, with nothing dropped -- every state sent on time and then
// held in the air until the radio woke up. So a solo game is not sent. It is played
// here, and the server replays it afterwards to check the score.
function local(game, me, publish, finish) {
  const players = game.snakes.map((snake) => snake.player);
  const board = rules.game(game.seed, players);
  board.start();

  const seat = players.indexOf(me.sub);
  const tickMs = 1000 / rules.TICK_HZ;
  const moves = []; // the input log: what the server will replay to check us
  let spare = 0;
  let painted = null;
  let reported = false;

  const show = () => {
    publish?.({
      ...board.state(),
      status: board.over ? "finished" : "active",
      over: board.over,
      draw: board.over, // solo ends as a draw on the wire; outcome() reads it
      winner: null,
    });
  };
  show();

  return {
    read(now) {
      if (painted === null) painted = now;
      // A backgrounded tab hands back a gap of many seconds, and simulating a minute
      // of Snake in one frame is not catching up, it is a death sentence delivered
      // while you were not looking. Cap it and let the clock slip.
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
      // run() in snake.py applies a move at tick k and THEN ticks k, so these line up.
      moves.push({ tick: board.ticks, dir });
      return true;
    },
  };
}

// -- somebody else's game, off the wire -------------------------------------
//
// Draw the newest state, with every head carried forward by however long ago it
// arrived. That is all the netcode a continuous game needs: a snake goes straight far
// more often than it turns, so the guess is nearly always right -- and when it is
// wrong it is wrong by a fraction of a unit, which is a smudge, not a death.
//
// On a grid this same guess was worth a whole cell, and a whole cell is the difference
// between alive and dead. That is the entire reason this game left the grid.
function carried(state, seconds) {
  const ahead = Math.min(Math.max(seconds, 0), LEAD_MAX);
  const step = state.speed * ahead;

  return {
    ...state,
    snakes: state.snakes.map((snake) => {
      if (!snake.alive || !snake.path.length) return snake;

      const [dx, dy] = rules.DIRECTIONS[snake.heading] ?? [0, 0];
      const [hx, hy] = snake.path[0];
      const path = snake.path.map((p) => [p[0], p[1]]);
      path[0] = [hx + dx * step, hy + dy * step];
      return { ...snake, path };
    }),
  };
}

export function create({ root, me, send, publish, finish }) {
  let mine = null; // the game we are playing ourselves, when it is ours to play
  let latest = null; // ...or the newest one off the wire, when it is not
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
      if (ours && ours.path.length) {
        meter.frame({
          now,
          head: ours.path[0],
          path: mine ? "local" : "wire",
          delayMs: mine ? 0 : now - arrived,
          tickMs: 1000 / rules.TICK_HZ,
          dropped: 0,
          stateAge: mine ? 0 : now - arrived,
        });
      }
    }
  });
  hint(root, t("snake.hint"));
  const meter = readout(root, board.element);

  const post = onChange(send);
  const intend = (input) => {
    // A game we run ourselves needs no wire and no dedupe: the answer to "did that
    // turn land" is yes, at once, and the rules that would refuse it refuse it here.
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
    if (!snake.path.length) return;

    const colour = COLOURS[seat % COLOURS.length];
    context.globalAlpha = snake.alive ? 1 : 0.25;

    // The body IS a path, so stroke it. Round joins and caps because a snake has no
    // corners -- and because a mitred join on a right angle would spike out past the
    // body and kill you somewhere the rules say you are safe.
    if (snake.path.length > 1) {
      context.strokeStyle = colour;
      context.lineWidth = game.bodyR * 2 * unit;
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(snake.path[0][0] * unit, snake.path[0][1] * unit);
      for (let i = 1; i < snake.path.length; i += 1) {
        context.lineTo(snake.path[i][0] * unit, snake.path[i][1] * unit);
      }
      context.stroke();
    }

    const [hx, hy] = snake.path[0];
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
  // there was nobody to beat. Correct on the wire, absurd in the room -- a neutral
  // chime at somebody who just died. You lost. Have the trombone.
  if (game.snakes.length !== 1) return null;
  return game.snakes[0].player === me.sub ? "lose" : "none";
}

const score = (length) => Math.round(length * 10) / 10;

export function describe(game, me) {
  if (game.status === "waiting") return null;

  const mine = game.snakes.find((snake) => snake.player === me.sub);
  const solo = game.snakes.length === 1;

  if (game.over) {
    // A spectator has no snake, so nothing here may reach through `mine` unchecked.
    if (solo) {
      const seconds = Math.round(game.seconds * 10) / 10;
      return mine
        ? t("snake.solo_over", { seconds, length: score(mine.length) })
        : t("snake.solo_over_watched", { seconds });
    }
    if (game.draw) return t("snake.all_crashed");
    return game.winner === me.sub
      ? t("snake.you_survived", { length: score(mine.length) })
      : t("ui.they_won", { name: game.playerNames[game.winner] });
  }

  const you = mine
    ? mine.alive
      ? t("snake.length", { length: score(mine.length) })
      : t("snake.you_crashed")
    : t("snake.watching");

  if (solo) return you;

  const alive = game.snakes.filter((snake) => snake.alive).length;
  return t("snake.status", { you, alive });
}
