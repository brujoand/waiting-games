// Snake's rules, in the browser.
//
// THE TWIN OF waiting_games/games/snake.py, AND IT MUST STAY ITS TWIN. Two copies
// of a rulebook drift, silently, and the drift shows up as a player who died on
// their own screen and lived on the server's -- so they are pinned to each other
// by tests/test_determinism.py, which runs the SAME seed and the SAME moves
// through both and demands the same board out the far end, cell for cell. Change a
// rule here and that test fails until you change it there. That is the deal, and
// it is the only thing making this safe.
//
// -- why the browser has a rulebook at all ----------------------------------
//
// Because a phone cannot be shown this game over a radio. Measured, on a real one,
// mid-game: the gaps between state arrivals ran a median of 168ms -- the tick,
// exactly -- a ninetieth percentile of 333ms, and a worst of 2439ms. Nothing was
// dropped. Every state was sent on time and then held in the air until the radio
// woke up to listen. You cannot render a game you are being told about two seconds
// late, and no amount of interpolation, buffering or catching-up changes that. The
// packet has to come out of the render loop.
//
// So it does. The game is deterministic -- one player, one input stream, and a seed
// the server hands out (see _rng.js) -- which means the browser can simply play it.
// Your turn lands on the next LOCAL tick. Nothing waits for the wire, and the radio
// may sleep as long as it likes.
//
// This is not the client being trusted. It is the client being CHECKED: the run is
// a pure function of (seed, moves, ticks), so the server replays it afterwards and
// looks at the result itself. See snake.py's replay().
//
// There is never a second snake here -- Snake seats one, and a grid is why (see
// snake.py). Snakes is the shared game, and it has its own rulebook.

import { rng } from "./_rng.js";

export const WIDTH = 24;
export const HEIGHT = 24;
const START_LENGTH = 3;
const APPLES = 3;
const GROWTH = 2; // cells gained per apple

export const DIRECTIONS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

const key = ([x, y]) => `${x},${y}`;

/**
 * A game of Snake, played here. `seed` and `players` come from the server.
 *
 * The shape of every method mirrors snake.py, deliberately and unfashionably --
 * two files that have to say the same thing are easier to keep saying it when they
 * say it the same way. tick() executes the move decided last tick and then decides
 * the next, exactly as the engine does.
 */
export function game(seed, players) {
  const random = rng(seed);
  const snakes = [];
  let apples = [];
  let elapsed = 0;
  let over = false;
  let ticks = 0;

  function occupied() {
    const taken = new Set();
    for (const snake of snakes) {
      if (snake.alive) for (const cell of snake.cells) taken.add(key(cell));
    }
    for (const apple of apples) taken.add(key(apple));
    return taken;
  }

  function growAnApple() {
    const taken = occupied();
    const free = [];
    // x THEN y, and the order is load-bearing: snake.py builds the same list in
    // the same order and takes the same index out of it. Swap these loops and the
    // apples move -- on one side of the wire only.
    for (let x = 0; x < WIDTH; x += 1) {
      for (let y = 0; y < HEIGHT; y += 1) {
        if (!taken.has(key([x, y]))) free.push([x, y]);
      }
    }
    if (free.length) apples.push(free[random.below(free.length)]);
  }

  function start() {
    // One snake, halfway down the board -- snake.py's _on_start, cell for cell. It
    // is still a LIST of one: the wire shape is a list of snakes, and the renderer,
    // the replay and the engine all read snakes[0].
    const row = Math.floor(HEIGHT / 2);
    const cells = [];
    for (let i = 0; i < START_LENGTH; i += 1) cells.push([START_LENGTH - i, row]);
    snakes.push({
      cells,
      heading: "right",
      pending: "right",
      growing: 0,
      alive: true,
      step: null,
      player: players[0],
    });

    apples = [];
    for (let i = 0; i < APPLES; i += 1) growAnApple();
    decide();
  }

  // The direction it will be travelling once the move in flight has been made --
  // which is what a reversal has to be judged against, not the one it last made.
  const facing = (snake) => (snake.step ? snake.step.heading : snake.heading);

  /** The player asks to turn. Returns false if the rules say no. */
  function steer(seat, heading) {
    const snake = snakes[seat];
    if (!DIRECTIONS[heading] || !snake || !snake.alive) return false;

    const [dx, dy] = DIRECTIONS[heading];
    const [cx, cy] = DIRECTIONS[facing(snake)];
    if (snake.cells.length > 1 && dx === -cx && dy === -cy) return false; // the neck

    snake.pending = heading;
    return true;
  }

  function execute() {
    for (const snake of snakes) {
      if (!snake.alive || !snake.step) continue;

      if (!snake.step.to) {
        snake.alive = false;
        continue;
      }

      const head = snake.step.to;
      snake.heading = snake.step.heading;
      snake.cells.unshift(head);

      const eaten = apples.findIndex((a) => a[0] === head[0] && a[1] === head[1]);
      if (eaten !== -1) {
        apples.splice(eaten, 1);
        snake.growing += GROWTH;
        growAnApple();
      }

      if (snake.growing) snake.growing -= 1;
      else snake.cells.pop();
    }
  }

  /** Fix what happens on the NEXT tick. The same arithmetic as snake.py's _decide. */
  function decide() {
    const living = snakes.filter((s) => s.alive);

    const heads = new Map();
    for (const snake of living) {
      const [dx, dy] = DIRECTIONS[snake.pending];
      const [x, y] = snake.cells[0];
      heads.set(snake, [x + dx, y + dy]);
    }

    const bodies = new Set();
    for (const snake of living) {
      const keep = snake.growing ? snake.cells : snake.cells.slice(0, -1);
      for (const cell of keep) bodies.add(key(cell));
    }

    const doomed = new Set();
    for (const [snake, head] of heads) {
      const [x, y] = head;
      if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) doomed.add(snake); // the wall
      else if (bodies.has(key(head))) doomed.add(snake); // itself
    }

    for (const snake of living) {
      const head = heads.get(snake);
      const eating = apples.some((a) => a[0] === head[0] && a[1] === head[1]);
      snake.step = {
        heading: snake.pending,
        to: doomed.has(snake) ? null : head,
        grows: snake.growing > 0 || eating,
      };
    }
  }

  function settle() {
    if (!snakes.some((s) => s.alive)) over = true;
  }

  return {
    start,
    steer,

    tick(dt) {
      if (over) return;
      elapsed += dt;
      if (!snakes.some((s) => s.alive)) return;

      execute();
      settle();
      decide();
      ticks += 1;
    },

    get over() {
      return over;
    },
    get ticks() {
      return ticks;
    },

    /** The same shape snake.py puts on the wire, so the renderer cannot tell them
     * apart -- which is the point: one renderer, two sources of truth. */
    state() {
      return {
        width: WIDTH,
        height: HEIGHT,
        seed,
        apples: apples.map((a) => [...a]),
        seconds: Math.round(elapsed * 10) / 10,
        snakes: snakes.map((snake) => ({
          player: snake.player,
          cells: snake.cells.map((c) => [...c]),
          alive: snake.alive,
          length: snake.cells.length,
          next: snake.alive && snake.step && snake.step.to ? [...snake.step.to] : null,
          grows: Boolean(snake.alive && snake.step && snake.step.grows),
        })),
      };
    },
  };
}
