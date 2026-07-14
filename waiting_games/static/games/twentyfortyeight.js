// 2048.
//
// A dom game, not a canvas one -- the board only changes when you move it. But it
// steers like the real-time games do, so it borrows their keyboard and swipe
// helpers rather than growing a second, subtly different copy of the phone logic.
//
// What it does NOT borrow is onChange(): that helper sends an intent only when it
// CHANGES, which is right for a snake that is already heading left and wrong here,
// where sliding left twice is two moves.
//
// The board is drawn twice over: sixteen squares that never move, and on top of
// them one element per tile, which does. A tile is a THING that travels, not a
// number printed in a square -- and that is the whole difference between this and
// the version before it, which diffed the numbers cell by cell and so could only
// blink them. Two 2s meeting to make a 4, and a 4 sliding in from the far wall,
// left exactly the same trail of changed squares, and the player was left to guess
// which had happened. Now the server says which (see twentyfortyeight.py): a tile
// that merely moved travels, and a tile that merged travels, lands and swells.

import { t } from "../i18n.js";
import { keys, swipe } from "./_canvas.js";

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

// Slow enough to WATCH.
//
// This was 110ms, which is roughly what the original game uses, and it was too
// quick to follow: the tiles were plainly moving and you still could not say which
// ones had. A move is something to be READ, and there is time to read it -- the
// board is only ever waiting on the player. So the slide takes its time, and the
// swell that follows happens AFTER it rather than under it, because two things at
// once are one thing you cannot see.
//
// The whole move is a little over a third of a second. That is the ceiling: past
// about half a second the animation stops explaining the move and starts being
// something you sit through, and a player who already knows what they pressed
// resents every frame of it.
const SLIDE_MS = 190;

const still = window.matchMedia("(prefers-reduced-motion: reduce)");

export function create({ root, send }) {
  root.className = "board-2048";

  const grid = document.createElement("div");
  grid.className = "t48-grid";
  root.replaceChildren(grid);

  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = t("twentyfortyeight.hint");
  root.append(note);

  // A spectator may not move the board, but the server would refuse them anyway
  // (move.not_seated), so there is nothing to gate here -- the listeners bind
  // once and the platform's rules do the rest.
  const stopKeys = keys(ARROWS, send);
  const stopSwipe = swipe(grid, send, SWIPES);

  let size = 0;
  let squares = []; // the empty slots underneath: they never move and never change
  let tiles = new Map(); // cell -> the tile element standing on it
  let drawn = null; // the move number the board on screen is showing

  let flying = []; // the animations of a slide still in the air...
  let landing = null; // ...and the state they are landing on

  function cell(className, index) {
    const element = document.createElement("div");
    element.className = className;
    element.style.gridArea = `${Math.floor(index / size) + 1} / ${(index % size) + 1}`;
    return element;
  }

  // Where cell `from` sits relative to cell `to`, in pixels. Measured off the
  // empty squares rather than worked out from the board's width, because they are
  // the ones the browser has already laid out -- so the gap, the padding, and
  // whatever size the board happens to be on this screen are all accounted for
  // without this file knowing a thing about any of them.
  function offset(from, to) {
    const start = squares[from].getBoundingClientRect();
    const end = squares[to].getBoundingClientRect();
    return [start.left - end.left, start.top - end.top];
  }

  function lay(game) {
    if (size === game.size) return;

    size = game.size;
    grid.style.setProperty("--size", size);
    squares = game.tiles.map((_, index) => cell("t48-square", index));
    grid.replaceChildren(...squares);
    tiles = new Map();
    drawn = null;
  }

  // The board as the server has it, with no history: every tile where it belongs,
  // nothing in flight. This is what a spectator sees on arrival, what a reconnect
  // gets, and what a slide settles into once it has landed.
  function paint(game, flair = null) {
    // Swept out of the DOM, not out of the map. Mid-slide the two halves of a merge
    // are two elements standing on ONE square, and a map keyed by square can only
    // hold one of them -- so clearing the map would leave the absorbed tile on the
    // board for ever, sitting under the tile it just became. It did, briefly: a 2
    // that never left, hidden beneath its own 4.
    for (const tile of grid.querySelectorAll(".t48-tile")) tile.remove();
    tiles.clear();

    game.tiles.forEach((value, index) => {
      if (!value) return;

      const tile = cell("t48-tile", index);
      tile.dataset.value = String(value);
      tile.textContent = String(value);
      grid.append(tile);
      tiles.set(index, tile);

      if (!flair) return;
      // A tile that was BORN and a tile that was MADE are different events, and a
      // player has to tell them apart at a glance: the new one fades up out of
      // nothing, the merged one lands and swells.
      if (index === flair.spawned) once(tile, "t48-arrive");
      else if (flair.merged.has(index)) once(tile, "t48-merge");
    });

    drawn = game.moves;
  }

  // Play a css animation and take the class off again afterwards, so the same tile
  // can play the same one twice. Reduced motion wants the board, not the show.
  function once(tile, className) {
    if (still.matches) return;
    tile.classList.add(className);
    tile.addEventListener("animationend", () => tile.classList.remove(className), {
      once: true,
    });
  }

  // Whatever was in the air has arrived. Called before every state, so a player
  // drumming the keys faster than the animation runs gets a board that is always
  // the server's -- only, now and then, one that was cut short. Never one that is
  // half a move behind, sliding tiles that are no longer there.
  function settle(flair = null) {
    if (!landing) return;

    const arrived = landing;
    landing = null;
    for (const animation of flying) animation.cancel();
    flying = [];
    paint(arrived, flair);
  }

  // Can this state be drawn as a MOVE from the one on screen, rather than simply
  // replacing it? Only if it IS the next move, and only if every tile the server
  // says slid is a tile we have. The second half is what makes the first safe to
  // trust: if our picture has drifted from the server's for any reason at all, we
  // paint theirs rather than animate a story about it.
  function journeys(game) {
    if (still.matches) return null;
    if (drawn === null || game.moves !== drawn + 1) return null;
    if (!game.slid || !game.slid.length) return null;

    const slid = game.slid.map((step) => ({ ...step, tile: tiles.get(step.from) }));
    return slid.every((step) => step.tile) ? slid : null;
  }

  function slide(game, slid) {
    const merged = new Set();

    // Each tile is placed where it is GOING, then thrown back to where it came
    // from and let travel -- so the browser lays the final board out, and the
    // animation is only the trip. A tile that ends where it began has nowhere to
    // travel from, and just stays put.
    for (const { tile, from, to, merged: absorbed } of slid) {
      tile.style.gridArea = `${Math.floor(to / size) + 1} / ${(to % size) + 1}`;
      if (absorbed) merged.add(to);

      const [dx, dy] = offset(from, to);
      if (!dx && !dy) continue;

      flying.push(
        tile.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: SLIDE_MS, easing: "ease-in-out" },
        ),
      );
    }

    // Nothing is standing on a square now -- it is all in the air, and two of them
    // are on their way to the same one. There is no settled board to keep a map of
    // until this lands, and paint() builds the next one from the server's, which is
    // the only version of it that was ever true.
    tiles.clear();
    landing = game;

    const trip = flying.map((animation) => animation.finished.catch(() => {}));
    Promise.all(trip).then(() => {
      // A newer move may have landed this one early and set off on its own. The
      // board has moved past us; ours is no longer the picture to draw.
      if (landing === game) settle({ merged, spawned: game.spawned });
    });
  }

  return {
    update(game) {
      if (game.status === "waiting") return; // no board dealt yet

      settle();
      lay(game);

      const slid = journeys(game);
      if (slid) slide(game, slid);
      else paint(game);
    },

    destroy() {
      stopKeys();
      stopSwipe();
      for (const animation of flying) animation.cancel();
    },
  };
}

export function outcome(game) {
  // A solo run has nobody to lose TO, so the engine ends a jammed board as a DRAW
  // -- see twentyfortyeight.py. On the wire that is the only honest answer; in the
  // room it would mean a neutral, never-mind chime for a run that just died.
  //
  // A win still is a win: leave that one to the platform.
  if (game.seat === null || game.seat === undefined) return null; // a spectator
  return game.draw ? "lose" : null;
}

export function describe(game, me) {
  // Not before the board is dealt. This is deliberately NOT `!== "active"`:
  // a finished session's status is "finished", so that test quietly swallowed
  // every game-over line below it and left the platform's generic one to speak
  // for a game it does not understand.
  if (game.status === "waiting") return null;

  // Seat 0 is a real seat and it is also falsy, so this cannot be `!game.seat`.
  const playing = game.seat !== null && game.seat !== undefined;

  if (game.over) {
    if (game.winner === me.sub) {
      return t("twentyfortyeight.you_made_it", {
        target: game.target,
        score: game.score,
      });
    }
    if (!playing) return t("twentyfortyeight.run_over_watched", { score: game.score });
    return t("twentyfortyeight.stuck", { score: game.score });
  }

  return playing
    ? t("twentyfortyeight.score", { score: game.score })
    : t("twentyfortyeight.watching", { score: game.score });
}
