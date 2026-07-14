// Snake's rules, in the browser. Off the grid.
//
// THE TWIN OF waiting_games/games/snake.py, AND IT MUST STAY ITS TWIN. Two copies of
// a rulebook drift, and the drift would not look like a broken build -- it would look
// like a player who died on their own screen and lived on the server's. They are
// pinned to each other by tests/test_determinism.py, which runs the same seed and the
// same moves through both and demands the same board, down to the last bit of the
// last float.
//
// FLOATS ARE FINE. sin, cos and sqrt ARE NOT. Every number here moves through
// + - * / only, on IEEE-754 doubles, which both languages specify identically.
// Distances are compared SQUARED so that no square root is ever taken -- a sqrt is
// permitted by its own standard to differ in the last bit between implementations,
// and one bit is two different games. There is no angle anywhere, which is exactly
// why the snake turns in four directions rather than through a full circle.
//
// Every operation happens in the same ORDER as snake.py's, and that is not tidiness
// either: floating-point addition is not associative, so `a + b + c` and `a + (b + c)`
// can differ in the last bit. A reordering here would be a divergence there.

import { rng } from "./_rng.js";

export const BOARD = 24.0;
export const SPEED = 6.0; // units per second
export const TICK_HZ = 20.0;

const START_LENGTH = 3.0;
const GROWTH = 2.0;
const APPLES = 3;

export const HEAD_R = 0.45;
export const BODY_R = 0.4;
export const APPLE_R = 0.4;

// How much of your own body, back from the head, cannot kill you. Off the grid you
// may turn whenever you like, so a quick left-then-left brings the head alongside its
// own neck within a fraction of a unit -- and being killed for turning twice in a
// hurry is not a rule anybody would call fair.
const NECK = 1.6;

// How far the snake must travel between one turn and the next.
//
// The grid gave us this for free. Off the grid you can turn wherever you like -- so
// turn down, and a fifth of a unit later turn left, and the snake is running PARALLEL
// TO ITS OWN BODY a fifth of a unit away, when the body is four fifths of a unit wide.
// It is inside itself. No neck length fixes that; it is geometry.
//
// Every game with a body and a free heading answers this the same way: a minimum
// turning radius. slither.io caps how fast you can swing round; ours is four
// directions, so the cap is a distance -- one body-width and a bit, which is exactly
// the separation two parallel runs need in order not to touch.
//
// And it is SOFT: ask too early and the turn is remembered, not refused, and taken the
// moment it is legal. An early press still works; a late one turns you a little
// further along. The grid's discipline is back. Its fatal quantum is not.
const MIN_TURN = 1.0;

export const DIRECTIONS = {
  up: [0.0, -1.0],
  down: [0.0, 1.0],
  left: [-1.0, 0.0],
  right: [1.0, 0.0],
};

const reach2 = (a, b) => (a + b) * (a + b);

function distance2ToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;

  const span = vx * vx + vy * vy;
  if (span === 0.0) return wx * wx + wy * wy; // a corner: the segment is a point

  let along = (wx * vx + wy * vy) / span;
  if (along < 0.0) along = 0.0;
  else if (along > 1.0) along = 1.0;

  const dx = px - (ax + vx * along);
  const dy = py - (ay + vy * along);
  return dx * dx + dy * dy;
}

/** A game of Snake, played here. `seed` and `players` come from the server. */
export function game(seed, players) {
  const random = rng(seed);
  const snakes = [];
  let apples = [];
  let elapsed = 0.0;
  let over = false;
  let ticks = 0;

  function clear(x, y, clearance) {
    for (const apple of apples) {
      const dx = x - apple[0];
      const dy = y - apple[1];
      if (dx * dx + dy * dy < reach2(clearance, APPLE_R)) return false;
    }
    for (const snake of snakes) {
      if (!snake.alive) continue;
      for (let i = 0; i < snake.path.length - 1; i += 1) {
        const a = snake.path[i];
        const b = snake.path[i + 1];
        const near = distance2ToSegment(x, y, a[0], a[1], b[0], b[1]);
        if (near < reach2(clearance, BODY_R)) return false;
      }
    }
    return true;
  }

  function growAnApple() {
    const margin = APPLE_R + 0.2;
    const span = BOARD - margin - margin;

    // A BOUNDED rejection loop, taking exactly as many tries as snake.py takes, off
    // exactly the same generator. Unbounded -- or dependent on anything the two sides
    // do not both have -- and the apples part company, and so do the games.
    for (let i = 0; i < 64; i += 1) {
      const x = margin + random.unit() * span;
      const y = margin + random.unit() * span;
      if (clear(x, y, APPLE_R)) {
        apples.push([x, y]);
        return;
      }
    }
  }

  function start() {
    const seats = players.length;
    for (let seat = 0; seat < seats; seat += 1) {
      const row = (BOARD * (seat + 1)) / (seats + 1);
      snakes.push({
        path: [
          [START_LENGTH + 1.0, row],
          [1.0, row],
        ],
        heading: "right",
        pending: "right",
        length: START_LENGTH,
        growing: 0.0,
        alive: true,
        straight: MIN_TURN, // distance since the last corner -- see MIN_TURN
        player: players[seat],
      });
    }
    apples = [];
    for (let i = 0; i < APPLES; i += 1) growAnApple();
  }

  /** Steer. Returns whether the rules allowed it -- the same rules the server has. */
  function steer(seat, heading) {
    const snake = snakes[seat];
    if (!DIRECTIONS[heading] || !snake || !snake.alive) return false;

    const [dx, dy] = DIRECTIONS[heading];
    const [cx, cy] = DIRECTIONS[snake.heading];
    if (dx === -cx && dy === -cy) return false; // no turning back on yourself

    snake.pending = heading;
    return true;
  }

  function advance(snake, step) {
    if (snake.pending !== snake.heading && snake.straight >= MIN_TURN) {
      // A corner: the head stops being a moving point and becomes a fixed one, and a
      // fresh head sets off from it.
      snake.path.unshift([snake.path[0][0], snake.path[0][1]]);
      snake.heading = snake.pending;
      snake.straight = 0.0;
    }

    snake.straight += step;

    const [dx, dy] = DIRECTIONS[snake.heading];
    snake.path[0][0] += dx * step;
    snake.path[0][1] += dy * step;

    if (snake.growing > 0.0) {
      const grown = step < snake.growing ? step : snake.growing;
      snake.length += grown;
      snake.growing -= grown;
    }

    trim(snake);
  }

  function trim(snake) {
    let left = snake.length;
    const kept = [];

    for (let i = 0; i < snake.path.length - 1; i += 1) {
      const a = snake.path[i];
      const b = snake.path[i + 1];
      // Axis-aligned, so a segment's length is |dx| + |dy| exactly. No sqrt.
      const span = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      kept.push(a);

      if (span >= left) {
        if (span === 0.0) kept.push([a[0], a[1]]);
        else {
          const part = left / span;
          kept.push([a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part]);
        }
        snake.path = kept;
        return;
      }
      left -= span;
    }

    kept.push(snake.path[snake.path.length - 1]);
    snake.path = kept;
  }

  function touches(x, y, other, skip) {
    let walked = 0.0;

    for (let i = 0; i < other.path.length - 1; i += 1) {
      const a = other.path[i];
      const b = other.path[i + 1];
      const span = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);

      if (walked + span <= skip) {
        walked += span;
        continue;
      }

      let ax = a[0];
      let ay = a[1];
      if (walked < skip && span > 0.0) {
        // The neck ends part-way along this segment. Start from there.
        const part = (skip - walked) / span;
        ax = a[0] + (b[0] - a[0]) * part;
        ay = a[1] + (b[1] - a[1]) * part;
      }

      if (distance2ToSegment(x, y, ax, ay, b[0], b[1]) < reach2(HEAD_R, BODY_R)) {
        return true;
      }
      walked += span;
    }

    return false;
  }

  function crashed(snake) {
    const x = snake.path[0][0];
    const y = snake.path[0][1];

    if (x < HEAD_R || x > BOARD - HEAD_R || y < HEAD_R || y > BOARD - HEAD_R) {
      return true;
    }

    for (const other of snakes) {
      if (!other.alive) continue;
      // Your own neck cannot kill you. Everybody else's body can, right up to the head.
      const skip = other === snake ? NECK : 0.0;
      if (touches(x, y, other, skip)) return true;
    }
    return false;
  }

  function eat(snake) {
    const x = snake.path[0][0];
    const y = snake.path[0][1];

    for (const apple of [...apples]) {
      const dx = x - apple[0];
      const dy = y - apple[1];
      // Overlap is enough. You run INTO an apple; you do not land on it, because there
      // is nowhere to land.
      if (dx * dx + dy * dy < reach2(HEAD_R, APPLE_R)) {
        apples.splice(apples.indexOf(apple), 1);
        snake.growing += GROWTH;
        growAnApple();
      }
    }
  }

  function settle() {
    const alive = snakes.filter((s) => s.alive);
    if (players.length === 1) {
      if (!alive.length) over = true;
      return;
    }
    if (alive.length <= 1) over = true;
  }

  return {
    start,
    steer,

    tick(dt) {
      if (over) return;
      elapsed += dt;

      const living = snakes.filter((s) => s.alive);
      if (!living.length) return;

      const step = SPEED * dt;
      for (const snake of living) advance(snake, step);

      // Everybody moves before anybody dies, so two heads meeting kill each other
      // rather than whoever happens to be first in the list.
      for (const snake of living.filter(crashed)) snake.alive = false;
      for (const snake of living) if (snake.alive) eat(snake);

      settle();
      ticks += 1;
    },

    get over() {
      return over;
    },
    get ticks() {
      return ticks;
    },

    /** The same shape snake.py puts on the wire, so one renderer draws either. */
    state() {
      return {
        board: BOARD,
        headR: HEAD_R,
        bodyR: BODY_R,
        appleR: APPLE_R,
        speed: SPEED,
        seed,
        apples: apples.map((a) => [a[0], a[1]]),
        seconds: elapsed, // raw: see snake.py. Rounding is the renderer's job.
        snakes: snakes.map((snake) => ({
          player: snake.player,
          path: snake.path.map((p) => [p[0], p[1]]),
          heading: snake.heading,
          alive: snake.alive,
          length: snake.length,
        })),
      };
    },
  };
}
