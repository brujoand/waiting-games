// Waiting Games - screen state machine + WebSocket client.
//
// The server is the only source of truth. We never render optimistically: a
// click sends a move and we redraw when the resulting state comes back.
//
// A game screen is MOUNTED ONCE and then updated. Do not go back to rebuilding
// it on every state push: a real-time game paints from a <canvas> that must
// survive between frames, and its key listeners must be torn down exactly once.

import { celebrate } from "./celebrate.js";
import { LANGUAGES, language, setLanguage, t } from "./i18n.js";
import { setSound, soundOn } from "./sound.js";

const appEl = document.getElementById("app");
const whoamiEl = document.getElementById("whoami");
const toastEl = document.getElementById("toast");

const state = {
  me: null,
  authMode: "cookie", // "cookie" | "proxy" -- from /api/config, before anything renders
  games: [],
  sessions: [],
  game: null, // the current game's state, when we are in one

  // The lobby's two filters. Both live here rather than in the dom, because the
  // lobby list repaints on every session anybody anywhere starts -- and a picker
  // that forgot what you had chosen every time a stranger opened a game would be
  // unusable.
  alone: false, // solo, or with other people
  pick: null, // the game key the picker is showing
};

let lobbySocket = null;
let gameSocket = null;
let heartbeat = null;

// The mounted game screen: the renderer ({update, destroy}), the module it came
// from (which may export its own status line), and the chrome around it.
let renderer = null;
let gameModule = null;
let mountedRound = null;
let statusEl = null;
let startButtonEl = null;
let rematchButtonEl = null;
let boardEl = null;
// The board's <h2>. mountGame() sets it ONCE, so without a handle it would keep
// the old language after a switch -- the one place the repaint is easy to miss.
let titleEl = null;

// The round we have already thrown confetti at. A finished game keeps pushing
// state -- a real-time one does so several times a second -- so without this the
// fanfare would fire on every frame for as long as the winner sat on the page.
let celebratedRound = null;

// A ROUND, not a game: a rematch replays the same session, so the same id is
// about to show a different board.
//
// Both of the once-per-board things hang off this. The renderer is mounted once
// per round, which is what hands a real-time game a clean slate -- Snake's
// interpolation buffer keys on the server's tick index, the new engine starts
// counting from zero again, and a buffer carried over from the last round would
// dismiss every state of this one as stale and freeze the snake solid. And the
// confetti is claimed once per round, so the next win is celebrated rather than
// swallowed as one we had already cheered.
function roundKey(game) {
  return `${game.id}#${game.sessionRound}`;
}

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
    const { detail } = await response.json().catch(() => ({}));
    // Ours is a coded object. FastAPI's OWN error bodies are not: a 422 detail is
    // a list and the router's 404 is a string. Neither is translatable, so neither
    // reaches the player as anything but a status code -- otherwise a Norwegian
    // user gets [object Object].
    throw new Error(
      detail?.code
        ? t(detail.code, detail.params)
        : t("error.request_failed", { status: response.status }),
    );
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
      toast(t(data.code, data.params));
    } else if (type === "closed") {
      // The game was thrown away under us. The server hangs up right after this,
      // but it says WHY first -- a bare disconnect looks like a server restart,
      // and would send us round the reconnect path instead of home.
      toast(t(data.code, data.params));
      go("#/");
    }
  };

  // The server closes with 1008 when the game does not exist -- which is also
  // what a server restart looks like, since all state is in memory.
  gameSocket.onclose = (event) => {
    if (event.code === 1008) {
      toast(t("ui.gone"));
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
    placeholder: t("ui.pick_a_name"),
    maxLength: 24,
    autofocus: true,
  });

  const submit = el("button", { className: "primary", textContent: t("ui.play") });

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
      el("h2", { textContent: t("ui.pick_a_name") }),
      form,
    ]),
  );
}

function renderWhoami() {
  // No sign-out in proxy mode: signing out means signing out of the identity
  // provider, and the proxy owns that session, not us.
  if (state.authMode === "proxy") {
    whoamiEl.replaceChildren(el("span", { textContent: state.me.name }));
    return;
  }

  const signOut = el("button", { className: "link", textContent: t("ui.sign_out") });
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

// Which games the toggle is currently showing.
//
// Not a partition, and it must not be made into one. A game is on the solo list
// if it CAN be played alone and on the other one if it CAN be played with other
// people, and Snake (1-6 players) is honestly both -- so it appears on both.
// 2048 seats exactly one, Tic-Tac-Toe needs two, and only those two lists are
// disjoint by accident.
function playable(game) {
  return state.alone ? game.minPlayers === 1 : game.maxPlayers > 1;
}

// "2-4 players", "2 players" -- and its own string for the one-seat game, because
// a plural rule is a language's business and not ours to fake with an `s`. 2048
// read "(1 players)" until this existed.
function seats(game) {
  const { minPlayers: min, maxPlayers: max } = game;
  if (max === 1) return t("ui.players_one");
  if (min === max) return t("ui.players_exact", { max });
  return t("ui.players_range", { min, max });
}

function renderHome() {
  const games = state.games.filter(playable);
  if (!games.some((game) => game.key === state.pick)) {
    state.pick = games[0]?.key ?? null; // the toggle moved out from under it
  }

  const picker = el("select", { id: "game-picker" });
  for (const game of games) {
    picker.append(
      el("option", {
        value: game.key,
        // The server's `title` is English and must never be rendered; the game is
        // named here, from its key, in the player's own language.
        textContent: t("ui.game_with_players", {
          game: gameTitle(game.key),
          players: seats(game),
        }),
      }),
    );
  }
  picker.value = state.pick ?? "";
  picker.onchange = () => {
    state.pick = picker.value;
  };

  const start = el("button", { className: "primary", textContent: t("ui.start_game") });
  start.disabled = state.pick === null;
  start.onclick = async () => {
    try {
      const session = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ game: state.pick }),
      });
      go(`#/game/${session.id}`);
    } catch (error) {
      toast(error.message);
    }
  };

  appEl.replaceChildren(
    el("section", { className: "panel" }, [
      el("h2", { textContent: t("ui.new_game") }),
      renderModes(),
      el("div", { className: "row" }, [picker, start]),
    ]),
    el("section", { className: "panel" }, [
      el("h2", { textContent: t("ui.join_a_game") }),
      state.sessions.length === 0
        ? el("p", {
            className: "empty",
            textContent: t("ui.nothing_waiting"),
          })
        : el("ul", { className: "sessions" }, state.sessions.map(renderSessionRow)),
    ]),
  );
}

// Solo or together, above the picker. Two buttons rather than a second <select>:
// there are two answers, it is the first thing you decide, and a menu you have to
// open to see two options in is a menu that hides them.
function renderModes() {
  const modes = [
    { alone: false, label: t("ui.together") },
    { alone: true, label: t("ui.alone") },
  ];

  return el(
    "div",
    { className: "modes" },
    modes.map(({ alone, label }) => {
      const button = el("button", { className: "mode", textContent: label });
      button.dataset.on = String(state.alone === alone);
      button.onclick = () => {
        state.alone = alone;
        renderHome();
      };
      return button;
    }),
  );
}

function renderSessionRow(session) {
  const label = el("div", {}, [
    el("strong", { textContent: gameTitle(session.game) }),
    el("span", {
      className: "meta",
      textContent:
        " " +
        t("ui.session_line", {
          host: session.host,
          seats: session.seats,
          status: t(`ui.status.${session.status}`),
        }),
    }),
  ]);

  const action = el("button", {
    textContent: session.joinable ? t("ui.join") : t("ui.watch"),
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

  // Only the host is offered it, and only the host is allowed it -- the button is
  // the courtesy, the server is the rule.
  const buttons = isMine(session)
    ? [closeButton(session.id), action]
    : [action];

  return el("li", {}, [label, el("div", { className: "row" }, buttons)]);
}

function isMine(session) {
  return session.hostSub === state.me.sub;
}

function closeButton(sessionId) {
  const button = el("button", {
    className: "danger",
    textContent: t("ui.close_game"),
  });
  button.onclick = async () => {
    // A game with other people in it is not yours alone to bin, so ask. The
    // browser's own confirm() is ugly and it is also unmissable, which is the
    // point: there is no undo behind this.
    if (!window.confirm(t("ui.confirm_close"))) return;
    try {
      await api(`/api/sessions/${sessionId}`, { method: "DELETE" });
    } catch (error) {
      toast(error.message);
    }
  };
  return button;
}

export function gameTitle(key) {
  return t(`game.${key}.title`);
}

// -- game screen ------------------------------------------------------------

function unmountGame() {
  // Not bookkeeping: a canvas game's key listeners live on window and its
  // requestAnimationFrame loop would keep painting into a detached canvas.
  if (renderer) renderer.destroy();
  renderer = null;
  gameModule = null;
  mountedRound = null;
  statusEl = null;
  startButtonEl = null;
  rematchButtonEl = null;
  boardEl = null;
  titleEl = null;
  celebratedRound = null;
}

// mountGame() awaits a dynamic import, so two state pushes arriving back to back
// would both see an unmounted screen and both mount one -- leaking a renderer,
// and with it a canvas game's rAF loop and key listeners. Serialise on the
// in-flight mount instead.
let mounting = null;

async function renderGame() {
  const game = state.game;

  if (mounting) await mounting;

  // A rematch changes the round, not the id, and the board it hands back is a new
  // one -- so this remounts, exactly as arriving at a different game does.
  if (mountedRound !== roundKey(game)) {
    unmountGame();
    mounting = mountGame(game);
    try {
      await mounting;
    } finally {
      mounting = null;
    }
  }

  // Whether the host may start, and whether there is anything to replay, are both
  // state-dependent -- so re-evaluate them on every push.
  startButtonEl.hidden = !mayStart(game);
  rematchButtonEl.hidden = !mayRematch(game);
  titleEl.textContent = gameTitle(game.game);
  statusEl.textContent = describeGame(game);
  renderer.update(game);

  // The TRANSITION into game-over, not the state of being over. mountGame() has
  // already claimed the round if the game was finished when we arrived, so a
  // reload on the results page is silent -- as it should be. Nobody wants a
  // trumpet for a game they lost ten minutes ago.
  if (game.over && celebratedRound !== roundKey(game)) {
    celebratedRound = roundKey(game);
    celebrate(outcomeOf(game), boardEl);
  }
}

function outcomeOf(game) {
  // A game may know better than the platform, and one does. Solo Snake ends as a
  // DRAW on the wire -- Result.draw(), because there was nobody to beat -- but
  // what actually happened is that you crashed. A neutral chime for "you died" is
  // exactly backwards, so Snake overrides this.
  const own = gameModule?.outcome?.(game, state.me);
  if (own) return own;

  // Seat 0 is a real seat and it is also falsy, so this test cannot be `!seat`.
  if (game.seat === null || game.seat === undefined) return "none";

  if (game.draw) return "draw";
  return game.winner === state.me.sub ? "win" : "lose";
}

function mayStart(game) {
  return game.status === "waiting" && game.hostSub === state.me.sub && game.canStart;
}

// Anyone who PLAYED may ask for another round -- the server agrees, and it is
// usually the loser who wants one. Seat 0 is a real seat and is also falsy, so
// this cannot be `!game.seat`; a spectator's seat is null, and they only watch.
function mayRematch(game) {
  return game.over && game.seat !== null && game.seat !== undefined;
}

async function mountGame(game) {
  const board = el("div", { id: "board" });
  boardEl = board;
  statusEl = el("p", { className: "status" });
  titleEl = el("h2");

  // Arriving at a game that is ALREADY finished -- a reload on the results page,
  // or following a link to somebody's last move -- is not a thing to celebrate.
  // Claiming the round here is what makes renderGame() fire on the transition
  // only.
  if (game.over) celebratedRound = roundKey(game);

  startButtonEl = el("button", { className: "primary", textContent: t("ui.start_now") });
  startButtonEl.onclick = async () => {
    try {
      await api(`/api/sessions/${game.id}/start`, { method: "POST" });
    } catch (error) {
      toast(error.message);
    }
  };

  rematchButtonEl = el("button", { className: "primary", textContent: t("ui.rematch") });
  rematchButtonEl.onclick = async () => {
    // Disabled for the round trip. Two clicks would be two rematches, and the
    // second one lands on a game that has already started over -- so the server
    // refuses it, and the player gets an error for having been keen. The state
    // push that starts the next round remounts this button anyway.
    rematchButtonEl.disabled = true;
    try {
      await api(`/api/sessions/${game.id}/rematch`, { method: "POST" });
    } catch (error) {
      rematchButtonEl.disabled = false;
      toast(error.message);
    }
  };

  // No Close button here. Throwing a game away is a thing you do to a game you are
  // LOOKING AT from the outside -- from the lobby row that is cluttering up your
  // list -- and it sat one careless click from the board, under a player who was
  // in the middle of playing it. The host closes their game from the lobby.
  appEl.replaceChildren(
    el("section", { className: "panel" }, [
      titleEl,
      statusEl,
      board,
      el("div", { className: "row" }, [
        startButtonEl,
        rematchButtonEl,
        el("button", { textContent: t("ui.back_to_lobby"), onclick: () => go("#/") }),
      ]),
    ]),
  );

  // Each game ships its own renderer; the platform only knows the game's key.
  gameModule = await import(`/static/games/${game.game}.js`);
  renderer = gameModule.create({ root: board, me: state.me, send: sendMove });
  mountedRound = roundKey(game);
}

function describeGame(game) {
  if (game.status === "waiting") {
    const waiting = t("ui.waiting_for_players", { seats: game.seats });
    return mayStart(game)
      ? t("ui.you_may_start", { waiting })
      : t("ui.still_waiting", { waiting });
  }

  // A game may describe itself: scores, phases, whose word it is.
  const own = gameModule?.describe?.(game, state.me);
  if (own) return own;

  if (game.over) {
    if (game.draw) return t("ui.draw");
    return game.winner === state.me.sub
      ? t("ui.you_won")
      : t("ui.they_won", { name: game.playerNames[game.winner] });
  }

  const others = Object.keys(game.playerNames).filter((sub) => sub !== state.me.sub);
  const missing = others.filter((sub) => !game.connected.includes(sub));
  const dropped = missing.length
    ? t("ui.disconnected", {
        names: missing.map((sub) => game.playerNames[sub]).join(", "),
      })
    : "";

  const turn =
    game.turn === state.me.sub
      ? t("ui.your_turn")
      : t("ui.their_turn", { name: game.playerNames[game.turn] });
  return turn + dropped;
}

// -- language ---------------------------------------------------------------

function mountLanguagePicker() {
  // In the header, not in renderWhoami(): it has to be reachable from the LOGIN
  // screen too, which is exactly where a Norwegian speaker first meets English.
  const picker = el("select", { id: "lang", title: t("ui.language") });
  for (const { code, label } of LANGUAGES) {
    picker.append(el("option", { value: code, textContent: label }));
  }
  picker.value = language();
  picker.onchange = () => setLanguage(picker.value);
  document.querySelector("header").append(picker);
}

function mountSoundToggle() {
  const button = el("button", { className: "link", id: "sound" });

  const label = () => {
    button.textContent = soundOn() ? t("ui.sound_on") : t("ui.sound_off");
  };
  button.onclick = () => {
    setSound(!soundOn());
    label();
  };
  label();

  // In the header beside the language, mounted once, so repaint() never touches
  // it -- which is also why its label has to be redrawn on a language change by
  // hand. Same trap as the board title.
  window.addEventListener("wg:languagechange", label);
  document.querySelector("header").append(button);
}

function repaint() {
  // A turn-based game that is simply sitting there gets no state push, so nothing
  // would redraw and the switch would look half-broken. Repaint from the state we
  // already hold.
  //
  // renderGame() does NOT remount (mountedId is unchanged), so a canvas game's
  // rAF loop and key listeners survive -- which is the whole point of the
  // mount-once contract.
  if (!state.me) return renderLogin();
  renderWhoami();
  if (state.game && currentGameId()) renderGame();
  else renderHome();
}

// -- boot -------------------------------------------------------------------

async function enterLobby() {
  state.games = await api("/api/games");
  state.sessions = await api("/api/sessions");
  renderWhoami();
  await route();
}

async function main() {
  mountLanguagePicker();
  mountSoundToggle();
  window.addEventListener("wg:languagechange", repaint);
  window.addEventListener("hashchange", () => {
    if (state.me) route();
  });
  window.addEventListener("beforeunload", () => {
    stopHeartbeat();
    closeSockets();
    unmountGame();
  });

  // Which identity model this deployment uses, before anything is rendered. In
  // proxy mode a 401 means the proxy did not inject its headers -- a name form
  // there would be a lie, and would 404 on submit.
  state.authMode = (await api("/api/config")).authMode;

  try {
    state.me = await api("/api/me"); // a live cookie, or the proxy's headers
  } catch {
    if (state.authMode === "proxy") {
      appEl.replaceChildren(
        el("p", { className: "empty", textContent: t("auth.proxy_missing") }),
      );
      return;
    }
    renderLogin();
    return;
  }
  await enterLobby();
}

main().catch((error) => {
  appEl.replaceChildren(el("p", { className: "empty", textContent: error.message }));
});
