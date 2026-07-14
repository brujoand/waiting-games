// Snakes' rules, in the browser. Off the grid, and with no edges.
//
// THE TWIN OF waiting_games/games/snakes.py, AND IT MUST STAY ITS TWIN. Two copies of
// a rulebook drift, and the drift would not look like a broken build -- it would look
// like a player who died on their own screen and lived on the server's. They are
// pinned by tests/test_determinism.py, which runs the same seed and the same moves
// through both and demands the same board, down to the last bit of the last float.
//
// FLOATS ARE FINE. sin, cos and sqrt ARE NOT. Every number moves through + - * / only,
// on IEEE-754 doubles, which both languages specify identically. Distances are compared
// SQUARED so no square root is ever taken. There is no angle anywhere -- which is why
// this snake turns in four directions rather than through a circle, and why the world
// is a TORUS rather than a sphere: a wrap is `x mod BOARD`, and a sphere is trigonometry.
//
// And every operation happens in the same ORDER as snakes.py's. Floating-point addition
// is not associative, so a reordering here would be a divergence there.

import { rng } from "./_rng.js";

export const BOARD = 24.0;
export const SPEED = 6.0;
export const TICK_HZ = 20.0;

const START_LENGTH = 3.0;
const GROWTH = 2.0;
const APPLES = 5;

export const HEAD_R = 0.45;
export const BODY_R = 0.4;
export const APPLE_R = 0.4;

const NECK = 1.6;
const MIN_TURN = 1.0; // the minimum turning radius -- see snakes.py

export const DIRECTIONS = {
  up: [0.0, -1.0],
  down: [0.0, 1.0],
  left: [-1.0, 0.0],
  right: [1.0, 0.0],
};

const reach2 = (a, b) => (a + b) * (a + b);

/** Squared distance from a point to a segment, ON A TORUS: the short way round. */
function near2(px, py, ax, ay, bx, by) {
  let best = -1.0;

  for (const ox of [-BOARD, 0.0, BOARD]) {
    for (const oy of [-BOARD, 0.0, BOARD]) {
      const sx = ax + ox;
      const sy = ay + oy;
      const ex = bx + ox;
      const ey = by + oy;

      const vx = ex - sx;
      const vy = ey - sy;
      const wx = px - sx;
      const wy = py - sy;

      const span = vx * vx + vy * vy;
      let near;
      if (span === 0.0) {
        near = wx * wx + wy * wy;
      } else {
        let along = (wx * vx + wy * vy) / span;
        if (along < 0.0) along = 0.0;
        else if (along > 1.0) along = 1.0;
        const dx = px - (sx + vx * along);
        const dy = py - (sy + vy * along);
        near = dx * dx + dy * dy;
      }

      if (best < 0.0 || near < best) best = near;
    }
  }

  return best;
}

function* segments(snake) {
  for (const stroke of snake.strokes) {
    for (let i = 0; i < stroke.length - 1; i += 1) {
      yield [stroke[i], stroke[i + 1]];
    }
  }
}

export function game(seed, players) {
  const random = rng(seed);
  const snakes = [];
  let apples = [];
  let elapsed = 0.0;
  let over = false;
  let ticks = 0;

  function clear(x, y, clearance) {
    for (const apple of apples) {
      if (near2(x, y, apple[0], apple[1], apple[0], apple[1]) < reach2(clearance, APPLE_R)) {
        return false;
      }
    }
    for (const snake of snakes) {
      if (!snake.alive) continue;
      for (const [a, b] of segments(snake)) {
        if (near2(x, y, a[0], a[1], b[0], b[1]) < reach2(clearance, BODY_R)) return false;
      }
    }
    return true;
  }

  function growAnApple() {
    // BOUNDED, and taking exactly as many tries as snakes.py takes off exactly the
    // same generator. Unbounded, or dependent on anything the two sides do not both
    // have, and the apples part company -- and so do the games.
    for (let i = 0; i < 64; i += 1) {
      const x = random.unit() * BOARD;
      const y = random.unit() * BOARD;
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
        strokes: [
          [
            [START_LENGTH + 1.0, row],
            [1.0, row],
          ],
        ],
        heading: "right",
        pending: "right",
        length: START_LENGTH,
        growing: 0.0,
        alive: true,
        straight: MIN_TURN,
        apples: 0,
        player: players[seat],
      });
    }
    apples = [];
    for (let i = 0; i < APPLES; i += 1) growAnApple();
  }

  function steer(seat, heading) {
    const snake = snakes[seat];
    if (!DIRECTIONS[heading] || !snake || !snake.alive) return false;

    const [dx, dy] = DIRECTIONS[heading];
    const [cx, cy] = DIRECTIONS[snake.heading];
    if (dx === -cx && dy === -cy) return false;

    snake.pending = heading;
    return true;
  }

  function advance(snake, step) {
    if (snake.pending !== snake.heading && snake.straight >= MIN_TURN) {
      const head = snake.strokes[0][0];
      snake.strokes[0].unshift([head[0], head[1]]); // a corner
      snake.heading = snake.pending;
      snake.straight = 0.0;
    }

    snake.straight += step;

    const [dx, dy] = DIRECTIONS[snake.heading];
    const head = snake.strokes[0][0];
    const x = head[0] + dx * step;
    const y = head[1] + dy * step;

    // Off an edge and on at the other. The stroke STOPS at the seam and a new one
    // starts across it -- a body running from x=23.9 to x=0.1 as one segment would be
    // drawn straight across the board and would kill everything it crossed.
    if (x < 0.0 || x >= BOARD || y < 0.0 || y >= BOARD) {
      const edge = dx < 0 || dy < 0 ? 0.0 : BOARD;
      let entry;
      if (dx !== 0.0) {
        head[0] = edge;
        entry = [BOARD - edge, head[1]];
      } else {
        head[1] = edge;
        entry = [head[0], BOARD - edge];
      }

      const over_ = Math.abs(x - head[0]) + Math.abs(y - head[1]);
      snake.strokes.unshift([[entry[0] + dx * over_, entry[1] + dy * over_], entry]);
    } else {
      head[0] = x;
      head[1] = y;
    }

    if (snake.growing > 0.0) {
      const grown = step < snake.growing ? step : snake.growing;
      snake.length += grown;
      snake.growing -= grown;
    }

    trim(snake);
  }

  function trim(snake) {
    let left = snake.length;
    const strokes = [];

    for (const stroke of snake.strokes) {
      const kept = [];
      let done = false;

      for (let i = 0; i < stroke.length - 1; i += 1) {
        const a = stroke[i];
        const b = stroke[i + 1];
        const span = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]); // axis-aligned
        kept.push(a);

        if (span >= left) {
          if (span === 0.0) kept.push([a[0], a[1]]);
          else {
            const part = left / span;
            kept.push([a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part]);
          }
          left = 0.0;
          done = true;
          break;
        }
        left -= span;
      }

      if (!done) kept.push(stroke[stroke.length - 1]);
      if (kept.length > 1) strokes.push(kept);
      if (done) break;
    }

    const head = snake.strokes[0][0];
    snake.strokes = strokes.length
      ? strokes
      : [
          [
            [head[0], head[1]],
            [head[0], head[1]],
          ],
        ];
  }

  function touches(x, y, other, skip) {
    let walked = 0.0;

    for (const [a, b] of segments(other)) {
      const span = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);

      if (walked + span <= skip) {
        walked += span;
        continue;
      }

      let ax = a[0];
      let ay = a[1];
      if (walked < skip && span > 0.0) {
        const part = (skip - walked) / span;
        ax = a[0] + (b[0] - a[0]) * part;
        ay = a[1] + (b[1] - a[1]) * part;
      }

      if (near2(x, y, ax, ay, b[0], b[1]) < reach2(HEAD_R, BODY_R)) return true;
      walked += span;
    }

    return false;
  }

  function crashed(snake) {
    const [x, y] = snake.strokes[0][0]; // no walls: nothing to hit but a snake

    for (const other of snakes) {
      if (!other.alive) continue;
      const skip = other === snake ? NECK : 0.0;
      if (touches(x, y, other, skip)) return true;
    }
    return false;
  }

  function eat(snake) {
    const [x, y] = snake.strokes[0][0];

    for (const apple of [...apples]) {
      // Overlap is enough. You run INTO an apple; there is nowhere to land.
      if (near2(x, y, apple[0], apple[1], apple[0], apple[1]) < reach2(HEAD_R, APPLE_R)) {
        apples.splice(apples.indexOf(apple), 1);
        snake.growing += GROWTH;
        snake.apples += 1;
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

    state() {
      return {
        board: BOARD,
        speed: SPEED,
        headR: HEAD_R,
        bodyR: BODY_R,
        appleR: APPLE_R,
        seed,
        apples: apples.map((a) => [a[0], a[1]]),
        seconds: elapsed,
        snakes: snakes.map((snake) => ({
          player: snake.player,
          strokes: snake.strokes.map((s) => s.map((p) => [p[0], p[1]])),
          heading: snake.heading,
          alive: snake.alive,
          length: snake.length,
          apples: snake.apples,
        })),
      };
    },
  };
}
