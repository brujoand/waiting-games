// Waiting Games - screen state machine + WebSocket client.
//
// The server is the only source of truth. We never render optimistically: a
// click sends a move and we redraw when the resulting state comes back.
//
// A game screen is MOUNTED ONCE and then updated. Do not go back to rebuilding
// it on every state push: a real-time game paints from a <canvas> that must
// survive between frames, and its key listeners must be torn down exactly once.

const appEl = document.getElementById("app");
const whoamiEl = document.getElementById("whoami");
const toastEl = document.getElementById("toast");

const state = {
  me: null,
  games: [],
  sessions: [],
  game: null, // the current game's state, when we are in one
};

let lobbySocket = null;
let gameSocket = null;
let heartbeat = null;

// The mounted game screen: the renderer ({update, destroy}), the module it came
// from (which may export its own status line), and the chrome around it.
let renderer = null;
let gameModule = null;
let mountedId = null;
let statusEl = null;
let startButtonEl = null;

// -- helpers ----------------------------------------------------------------

export function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  setTimeout(() => {
    toastEl.hidden = true;
  }, 4000);
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}

function socketUrl(path) {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}${path}`;
}

// Proxies and load balancers close idle upgraded connections. Keep them warm.
function startHeartbeat() {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    for (const socket of [lobbySocket, gameSocket]) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping", data: {} }));
      }
    }
  }, 25000);
}

function stopHeartbeat() {
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

// -- routing ----------------------------------------------------------------

function currentGameId() {
  const match = location.hash.match(/^#\/game\/(.+)$/);
  return match ? match[1] : null;
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const gameId = currentGameId();
  closeSockets();
  unmountGame();

  if (gameId) {
    openGameSocket(gameId);
  } else {
    state.game = null;
    openLobbySocket();
    renderHome();
  }
}

function closeSockets() {
  for (const socket of [lobbySocket, gameSocket]) {
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }
  lobbySocket = null;
  gameSocket = null;
}

// -- sockets ----------------------------------------------------------------

function openLobbySocket() {
  lobbySocket = new WebSocket(socketUrl("/ws/lobby"));
  lobbySocket.onmessage = (event) => {
    const { type, data } = JSON.parse(event.data);
    if (type === "sessions") {
      state.sessions = data;
      if (!currentGameId()) renderHome();
    }
  };
  startHeartbeat();
}

function openGameSocket(gameId) {
  gameSocket = new WebSocket(socketUrl(`/ws/sessions/${gameId}`));

  gameSocket.onmessage = (event) => {
    const { type, data } = JSON.parse(event.data);
    if (type === "state") {
      state.game = data;
      renderGame();
    } else if (type === "error") {
      toast(data.message);
    }
  };

  // The server closes with 1008 when the game does not exist -- which is also
  // what a server restart looks like, since all state is in memory.
  gameSocket.onclose = (event) => {
    if (event.code === 1008) {
      toast("That game is gone (the server may have restarted).");
      go("#/");
    }
  };

  startHeartbeat();
}

function sendMove(move) {
  if (gameSocket && gameSocket.readyState === WebSocket.OPEN) {
    gameSocket.send(JSON.stringify({ type: "move", data: move }));
  }
}

// -- login ------------------------------------------------------------------

function renderLogin() {
  whoamiEl.replaceChildren();

  const input = el("input", {
    id: "name",
    type: "text",
    placeholder: "Your name",
    maxLength: 24,
    autofocus: true,
  });

  const submit = el("button", { className: "primary", textContent: "Play" });

  const form = el("form", { className: "row" }, [input, submit]);
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      state.me = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ name: input.value }),
      });
      await enterLobby();
    } catch (error) {
      toast(error.message);
    }
  };

  appEl.replaceChildren(
    el("section", { className: "panel" }, [
      el("h2", { textContent: "Pick a name" }),
      form,
    ]),
  );
}

function renderWhoami() {
  const signOut = el("button", { className: "link", textContent: "Sign out" });
  signOut.onclick = async () => {
    stopHeartbeat();
    closeSockets();
    unmountGame();
    await api("/api/logout", { method: "POST" }).catch(() => {});
    state.me = null;
    state.game = null;
    renderLogin();
  };

  whoamiEl.replaceChildren(el("span", { textContent: state.me.name }), signOut);
}

// -- lobby screen -----------------------------------------------------------

function renderHome() {
  const picker = el("select", { id: "game-picker" });
  for (const game of state.games) {
    const players =
      game.minPlayers === game.maxPlayers
        ? `${game.maxPlayers} players`
        : `${game.minPlayers}-${game.maxPlayers} players`;
    picker.append(
      el("option", { value: game.key, textContent: `${game.title} (${players})` }),
    );
  }

  const start = el("button", { className: "primary", textContent: "Start game" });
  start.onclick = async () => {
    try {
      const session = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ game: picker.value }),
      });
      go(`#/game/${session.id}`);
    } catch (error) {
      toast(error.message);
    }
  };

  appEl.replaceChildren(
    el("section", { className: "panel" }, [
      el("h2", { textContent: "New game" }),
      el("div", { className: "row" }, [picker, start]),
    ]),
    el("section", { className: "panel" }, [
      el("h2", { textContent: "Join a game" }),
      state.sessions.length === 0
        ? el("p", {
            className: "empty",
            textContent: "No games waiting. Start one.",
          })
        : el("ul", { className: "sessions" }, state.sessions.map(renderSessionRow)),
    ]),
  );
}

function renderSessionRow(session) {
  const label = el("div", {}, [
    el("strong", { textContent: session.title }),
    el("span", {
      className: "meta",
      textContent: ` ${session.host} - ${session.seats} - ${describeStatus(session)}`,
    }),
  ]);

  const action = el("button", {
    textContent: session.joinable ? "Join" : "Watch",
  });
  action.onclick = async () => {
    try {
      if (session.joinable) {
        await api(`/api/sessions/${session.id}/join`, { method: "POST" });
      }
      go(`#/game/${session.id}`);
    } catch (error) {
      toast(error.message);
    }
  };

  return el("li", {}, [label, action]);
}

function describeStatus(session) {
  if (session.status === "waiting") return "waiting";
  if (session.status === "active") return "in progress";
  return "finished";
}

// -- game screen ------------------------------------------------------------

function unmountGame() {
  // Not bookkeeping: a canvas game's key listeners live on window and its
  // requestAnimationFrame loop would keep painting into a detached canvas.
  if (renderer) renderer.destroy();
  renderer = null;
  gameModule = null;
  mountedId = null;
  statusEl = null;
  startButtonEl = null;
}

// mountGame() awaits a dynamic import, so two state pushes arriving back to back
// would both see an unmounted screen and both mount one -- leaking a renderer,
// and with it a canvas game's rAF loop and key listeners. Serialise on the
// in-flight mount instead.
let mounting = null;

async function renderGame() {
  const game = state.game;

  if (mounting) await mounting;

  if (mountedId !== game.id) {
    unmountGame();
    mounting = mountGame(game);
    try {
      await mounting;
    } finally {
      mounting = null;
    }
  }

  // Whether the host may start is state-dependent, so re-evaluate every push.
  startButtonEl.hidden = !mayStart(game);
  statusEl.textContent = describeGame(game);
  renderer.update(game);
}

function mayStart(game) {
  return game.status === "waiting" && game.hostSub === state.me.sub && game.canStart;
}

async function mountGame(game) {
  const board = el("div", { id: "board" });
  statusEl = el("p", { className: "status" });

  startButtonEl = el("button", { className: "primary", textContent: "Start now" });
  startButtonEl.onclick = async () => {
    try {
      await api(`/api/sessions/${game.id}/start`, { method: "POST" });
    } catch (error) {
      toast(error.message);
    }
  };

  appEl.replaceChildren(
    el("section", { className: "panel" }, [
      el("h2", { textContent: game.title }),
      statusEl,
      board,
      el("div", { className: "row" }, [
        startButtonEl,
        el("button", { textContent: "Back to lobby", onclick: () => go("#/") }),
      ]),
    ]),
  );

  // Each game ships its own renderer; the platform only knows the game's key.
  gameModule = await import(`/static/games/${game.game}.js`);
  renderer = gameModule.create({ root: board, me: state.me, send: sendMove });
  mountedId = game.id;
}

function describeGame(game) {
  if (game.status === "waiting") {
    const waiting = `Waiting for more players (${game.seats})`;
    return mayStart(game) ? `${waiting}. You can start whenever you like.` : `${waiting}...`;
  }

  // A game may describe itself: scores, phases, whose word it is.
  const own = gameModule?.describe?.(game, state.me);
  if (own) return own;

  if (game.over) {
    if (game.draw) return "A draw.";
    return game.winner === state.me.sub
      ? "You win!"
      : `${game.playerNames[game.winner]} wins.`;
  }

  const others = Object.keys(game.playerNames).filter((sub) => sub !== state.me.sub);
  const missing = others.filter((sub) => !game.connected.includes(sub));
  const dropped = missing.length
    ? ` (${missing.map((sub) => game.playerNames[sub]).join(", ")} disconnected)`
    : "";

  const turn =
    game.turn === state.me.sub
      ? "Your turn"
      : `${game.playerNames[game.turn]}'s turn`;
  return turn + dropped;
}

// -- boot -------------------------------------------------------------------

async function enterLobby() {
  state.games = await api("/api/games");
  state.sessions = await api("/api/sessions");
  renderWhoami();
  await route();
}

async function main() {
  window.addEventListener("hashchange", () => {
    if (state.me) route();
  });
  window.addEventListener("beforeunload", () => {
    stopHeartbeat();
    closeSockets();
    unmountGame();
  });

  // A live cookie from an earlier visit skips the name prompt.
  try {
    state.me = await api("/api/me");
  } catch {
    renderLogin();
    return;
  }
  await enterLobby();
}

main().catch((error) => {
  appEl.replaceChildren(el("p", { className: "empty", textContent: error.message }));
});
