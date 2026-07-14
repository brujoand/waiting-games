// Snake.
//
// update() does NO dom work -- it just stashes the latest frame. The rAF loop
// paints from it. That is what keeps a 6 Hz state stream from stuttering a
// 60 Hz screen, and what stops the canvas being rebuilt on every push.

import { t } from "../i18n.js";
import { COLOURS, canvas, hint, keys, onChange, swipe } from "./_canvas.js";
import { readout } from "./_debug.js";
import { ahead, at, timeline } from "./_interpolate.js";
import * as rules from "./snake_rules.js";

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

// A solo game, played HERE.
//
// The server deals the board, hands over the seed, and does not tick. We run the
// rules ourselves -- snake_rules.js, the twin of snake.py, pinned to it by
// tests/test_determinism.py -- and report the run when it ends, for the server to
// play again and check.
//
// This exists because a phone cannot be shown this game over a radio. Measured, on
// a real one, mid-game: the gaps between state arrivals ran a median of 168ms (the
// tick, exactly), a 90th percentile of 333ms, and a worst of 2439ms, with nothing
// dropped. Every state was sent on time and then held in the air until the radio
// woke up. There is no renderer that survives that, and three of them were written
// trying: you can be smooth or you can be current, and on a line that stalls for
// two seconds you cannot be either for long.
//
// So take the packet out of the render loop. Your turn lands on the next LOCAL
// tick, which is the floor -- a snake cannot turn in the middle of a cell -- and
// the radio may sleep for as long as it likes.
function local(game, me, publish, finish) {
  const players = game.snakes.map((snake) => snake.player);
  const board = rules.game(game.seed, players);
  board.start();

  const seat = players.indexOf(me.sub);
  const tickMs = 1000 / game.tickHz;
  const moves = []; // the input log: what the server will replay to check us
  let spare = 0; // time owed to the simulation but not yet ticked
  let painted = null;
  let reported = false;

  const show = () => {
    const state = board.state();
    publish?.({
      ...state,
      status: board.over ? "finished" : "active",
      over: board.over,
      // Solo ends as a DRAW on the wire -- Result.draw(), because there was nobody
      // to beat. snake.js's outcome() is what turns that into the loss it actually
      // was, and it reads these.
      draw: board.over,
      winner: null,
    });
  };
  show();

  return {
    seat,

    /** Advance to `now` and hand back the moment to draw: a state, and how far
     * through the move in flight we are. A fixed timestep, so the simulation runs
     * the same whatever the screen is doing. */
    read(now) {
      if (painted === null) painted = now;
      // A backgrounded tab hands back a gap of many seconds, and simulating a
      // minute of Snake in one frame is not catching up, it is a death sentence
      // delivered while you were not looking. Cap it, and let the clock slip.
      spare += Math.min(now - painted, 500);
      painted = now;

      while (spare >= tickMs && !board.over) {
        board.tick(1 / game.tickHz);
        spare -= tickMs;
        show();
      }

      if (board.over) {
        if (!reported) {
          reported = true;
          finish?.({ ticks: board.ticks, moves });
        }
        spare = 0;
      }

      return {
        state: board.state(),
        alpha: board.over ? 1 : Math.min(spare / tickMs, 1),
        ahead: true,
      };
    },

    /** Steer, right now, on the next tick this simulation runs. Returns whether
     * the rules allowed it -- a reversal into your own neck is refused here by the
     * same code that refuses it on the server. */
    steer(dir) {
      if (board.over || !board.steer(seat, dir)) return false;
      // The tick it lands on, which is the next one to run. run() in snake.py
      // applies a move at tick k and THEN ticks k, so these line up exactly.
      moves.push({ tick: board.ticks, dir });
      return true;
    },
  };
}

export function create({ root, me, send, publish, finish }) {
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

  // When the browser owns the clock -- see local() above -- this is the game, and
  // the timeline above is not used at all. There is nothing to interpolate towards:
  // we ARE the server.
  let mine = null;
  let tickMs = 1000 / 6; // ...until the first state says otherwise

  const board = canvas(root, (context, side) => {
    const now = performance.now();
    const frame = mine ? mine.read(now) : clock?.read(now);
    if (!frame) return;

    paint(context, side, frame, me);

    // Nothing unless the page was loaded with ?debug. It reads the head off the
    // very cells that were just painted, so what it reports is what is on the
    // screen and not a second opinion about it.
    if (meter) {
      const ours = frame.state.snakes.find((snake) => snake.player === me.sub);

      // A game we are running ourselves has no connection to report on: there is
      // no buffer, no delay, and no state that can be late, because there is no
      // state coming. That is the entire point of it, and the readout should say
      // so rather than divide by a timeline that does not exist.
      const stats = clock
        ? clock.debug(now)
        : { delayTicks: 0, tickMs, dropped: 0, stateAge: 0 };

      if (ours) {
        meter.frame({
          now,
          head: where(frame, ours, 0),
          path: mine ? "local" : frame.ahead ? "live" : "catching up",
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
  //
  // It gets the board so it can count the raw pointer events the browser delivers,
  // BEFORE swipe() has an opinion about them. "The touch controls did not work" is
  // several different bugs -- a listener that never fired, a gesture iOS took back
  // to scroll with, a swipe below the threshold, a move the server rejected -- and
  // they are indistinguishable from the sofa and need different fixes.
  const meter = readout(root, board.element);

  // One deduper for every way of steering. A swipe, a key and a button are all
  // the same intent, and if each kept its own idea of what the server was last
  // told they would disagree the moment somebody used two of them.
  const post = onChange(send);
  const intend = (input) => {
    // A game we are running ourselves needs no wire and no dedupe: the answer to
    // "did that turn land" is yes, on the next local tick, and the rules that
    // would have refused it refuse it here instead. Nothing goes out until the
    // run is over, and then the whole log goes at once.
    if (mine) {
      if (mine.steer(input.dir)) meter?.pressed();
      return;
    }

    // Only time a press that actually goes out. onChange() swallows a repeat --
    // you pressed the way you were already going -- and a swallowed press has no
    // turn coming to answer it, so a stopwatch started on one would run until the
    // NEXT real turn and report that wait as if it were this press's.
    if (post(input)) meter?.pressed();
  };
  const stopKeys = keys(ARROWS, intend);
  const stopSwipe = swipe(board.element, intend, SWIPES);

  return {
    update(game) {
      // Before the clock starts there is nothing to animate -- and nothing to
      // animate BETWEEN, either: a game sitting in the lobby has no ticks.
      if (game.tick === undefined) return;

      // OUR game, or theirs? A solo board is dealt by the server and then played
      // here; anything with a second snake in it is arbitrated there, and we watch.
      tickMs = 1000 / game.tickHz;

      if (game.clientClock) {
        if (mine === null && game.status === "active" && game.snakes.length) {
          mine = local(game, me, publish, finish);
        }
        return; // the server is not ticking this one. There is nothing to accept.
      }

      if (clock === null) clock = timeline(game.tickHz);

      // The tick index is what makes a state a MOMENT rather than just the
      // newest thing we have. A push that carries no new tick -- somebody
      // connecting, somebody leaving -- is dropped on the floor by accept(),
      // which is why opening the page no longer stutters everyone else's snake.
      const now = performance.now();
      clock.accept(game, game.tick, now);

      // The gaps between arrivals are the connection's real character, and they
      // are what every constant in _interpolate.js is tuned against. Measure them
      // on the machine that has the problem.
      meter?.arrived(now, game.tick);
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
  // Snake has no winner to be. The run ends when you crash, and the engine reports
  // that as a DRAW -- Result.draw() -- because there was nobody to beat. Which is
  // correct on the wire and would be absurd in the room: the platform's rule would
  // play a neutral, that-was-close chime at somebody who just died.
  //
  // You crashed. It is a loss. Have the trombone. A watcher gets neither.
  return game.snakes[0]?.player === me.sub ? "lose" : "none";
}

export function describe(game, me) {
  // Not before the board is dealt. This is deliberately NOT `!== "active"`:
  // a finished session's status is "finished", so that test quietly swallowed
  // every game-over line below it and left the platform's generic one to speak
  // for a game it does not understand.
  if (game.status === "waiting") return null;

  // A spectator has no snake of their own -- any logged-in user may open a game
  // socket and watch -- so nothing here may reach through `mine` without checking.
  // Watching somebody else's run used to throw and blank the whole status line.
  const mine = game.snakes.find((snake) => snake.player === me.sub);

  if (game.over) {
    return mine
      ? t("snake.solo_over", { seconds: game.seconds, length: mine.length })
      : t("snake.solo_over_watched", { seconds: game.seconds });
  }

  // No clock on this line. The server streams `seconds` to one decimal place,
  // once per tick, and a status line that rewrites itself several times a second
  // is one nobody can actually read -- the digits just flicker. The elapsed time
  // IS the score, so it is reported once, when the run ends.
  if (!mine) return t("snake.watching");
  return mine.alive
    ? t("snake.length", { length: mine.length })
    : t("snake.you_crashed");
}
