// Battleship.
//
// Two grids: your own waters (where your fleet is, and the enemy's splashes) and
// theirs (where only your own shots show). The enemy fleet is never in this
// browser's payload at all -- there is nothing to hide client-side, and nothing
// to find in devtools.

export function create({ root, me, send }) {
  root.className = "board-bs";

  return {
    update(game) {
      if (game.phase === "placing") {
        root.replaceChildren(arranging(game, me, send));
      } else {
        root.replaceChildren(
          grid("The enemy", enemyCells(game, me), (cell) => send({ cell }), canFire(game, me)),
          grid("Your waters", ownCells(game, me), null, false),
        );
      }
    },

    destroy() {},
  };
}

function canFire(game, me) {
  return game.status === "active" && !game.over && game.turn === me.sub;
}

// -- placing ----------------------------------------------------------------

function arranging(game, me, send) {
  const wrap = document.createElement("div");
  const iAmReady = game.ready[me.sub];

  wrap.append(grid("Your fleet", ownCells(game, me), null, false));

  const row = document.createElement("div");
  row.className = "row";

  const shuffle = document.createElement("button");
  shuffle.textContent = "Shuffle";
  shuffle.disabled = iAmReady;
  shuffle.onclick = () => send({ action: "shuffle" });

  const ready = document.createElement("button");
  ready.className = "primary";
  ready.textContent = iAmReady ? "Ready - waiting..." : "Ready";
  ready.disabled = iAmReady;
  ready.onclick = () => send({ action: "ready" });

  row.append(shuffle, ready);
  wrap.append(row);

  const waiting = Object.entries(game.ready)
    .filter(([sub, done]) => sub !== me.sub && !done)
    .map(([sub]) => game.playerNames[sub]);
  if (iAmReady && waiting.length) {
    const note = document.createElement("p");
    note.className = "hm-note";
    note.textContent = `Waiting for ${waiting.join(", ")}.`;
    wrap.append(note);
  }

  return wrap;
}

// -- the two grids ----------------------------------------------------------

function ownCells(game, me) {
  // My ships, plus whatever the enemy has thrown at me.
  const cells = new Map();
  for (const ship of game.myFleet ?? []) {
    for (const cell of ship.cells) {
      cells.set(cell, ship.hits.includes(cell) ? "hit" : "ship");
    }
  }

  const incoming = Object.entries(game.shotsBy)
    .filter(([sub]) => sub !== me.sub)
    .flatMap(([, shots]) => Object.entries(shots));
  for (const [cell, result] of incoming) {
    cells.set(Number(cell), result === "hit" ? "hit" : "miss");
  }

  return cells;
}

function enemyCells(game, me) {
  // Only what I have fired. The server never told me where their ships are.
  const cells = new Map();
  for (const [cell, result] of Object.entries(game.shotsBy[me.sub] ?? {})) {
    cells.set(Number(cell), result === "hit" ? "hit" : "miss");
  }
  return cells;
}

function grid(label, cells, onFire, live) {
  const wrap = document.createElement("div");
  wrap.className = "bs-grid";

  const heading = document.createElement("h3");
  heading.textContent = label;
  wrap.append(heading);

  const board = document.createElement("div");
  board.className = "bs-cells";

  for (let cell = 0; cell < 100; cell++) {
    const square = document.createElement("button");
    square.className = "bs-cell";
    const state = cells.get(cell);
    if (state) square.dataset.state = state;
    square.disabled = !live || Boolean(state);
    if (onFire) square.onclick = () => onFire(cell);
    board.append(square);
  }

  wrap.append(board);
  return wrap;
}

export function describe(game, me) {
  if (game.status !== "active") return null;

  if (game.phase === "placing") {
    return game.ready[me.sub]
      ? "You are ready. Waiting for your opponent..."
      : "Shuffle until you are happy with your fleet, then hit Ready.";
  }

  const sunk = game.sunkBy[me.sub] ?? [];
  const lost = Object.entries(game.sunkBy)
    .filter(([sub]) => sub !== me.sub)
    .flatMap(([, names]) => names);
  const tally = `Sunk ${sunk.length}/${game.fleet.length}, lost ${lost.length}/${game.fleet.length}`;

  if (game.over) {
    const who = game.winner === me.sub ? "You" : game.playerNames[game.winner];
    return `${tally}. ${who} won.`;
  }

  const turn =
    game.turn === me.sub ? "Your turn - fire!" : `${game.playerNames[game.turn]} is taking aim...`;
  return `${tally}. ${turn}`;
}
