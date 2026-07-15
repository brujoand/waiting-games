// Draw.
//
// One player is handed a word and draws it; everyone else types guesses against a
// clock. It is the platform's first game with a live text box, and that is what
// shapes the whole renderer.
//
// Every other renderer rebuilds its board with replaceChildren on each state push.
// A turn-based game pushes rarely, so that is free. This one is real-time -- ten
// states a second -- and one of the things on screen is an <input> the guesser is
// typing into. Blow it away ten times a second and they cannot type a single
// letter: the focus is lost and the value is cleared before the next keystroke.
//
// So the skeleton is built ONCE in create(), and update() mutates it in place --
// text, dataset, and an append-only guess log. The canvas paints from a
// requestAnimationFrame loop reading the latest state, the same decoupling
// _canvas.js documents: a dropped or late frame is a smooth stall, not a stutter,
// and the drawer's own in-progress stroke is painted locally so their pen feels
// instant instead of a radio-trip behind.

import { t } from "../i18n.js";

// The palette and the brush, client-side. The server only counts them (draw.py's
// NUM_COLOURS / NUM_WIDTHS), so it can clamp a junk index; the actual look lives
// here. Widths are in GRID units (0..COORD), so a brush scales with the canvas
// rather than being a fixed pixel size on every screen.
const COLOURS = [
  "#111111",
  "#e53935",
  "#1e88e5",
  "#43a047",
  "#fdd835",
  "#fb8c00",
  "#8e24aa",
  "#6d4c41",
];
const WIDTHS = [3, 8, 16, 30];

// A point is only sent once the pen has travelled this far in grid units since the
// last one. Dense enough to look like a line, sparse enough to keep well under the
// point cap and the move-rate bucket.
const STEP = 5;
// The pen batches its points and flushes at most this often, so a fast scribble is
// a handful of messages a second rather than one per frame.
const FLUSH_MS = 55;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) if (child) node.append(child);
  return node;
}

export function create({ root, me, send }) {
  root.className = "board-draw";

  let latest = null; // the newest state, for the paint loop to read

  // The pen's local, optimistic state.
  let drawing = false; // a stroke in progress right now
  let localStroke = null; // its grid points, painted on top of the server picture
  let pending = []; // points captured but not yet flushed to the server
  let lastSent = null; // the last grid point sent, for the STEP filter
  let lastFlush = 0;
  let brushColour = 0;
  let brushWidth = 1;

  // -- the skeleton, built once ---------------------------------------------

  const prompt = el("p", { className: "draw-prompt" });
  const timer = el("span", { className: "draw-timer" });
  const roundLabel = el("span", { className: "draw-round" });
  const topbar = el("div", { className: "draw-topbar" }, [roundLabel, timer]);

  const canvasEl = el("canvas", { className: "draw-canvas" });
  const context = canvasEl.getContext("2d");

  // The drawer's tools. Built always, shown only when it is your pen.
  const swatches = el("div", { className: "draw-swatches" });
  COLOURS.forEach((hex, index) => {
    const swatch = el("button", { className: "draw-swatch", type: "button" });
    swatch.style.background = hex;
    swatch.dataset.on = String(index === brushColour);
    swatch.onclick = () => {
      brushColour = index;
      for (const other of swatches.children) other.dataset.on = "false";
      swatch.dataset.on = "true";
    };
    swatches.append(swatch);
  });

  const sizes = el("div", { className: "draw-sizes" });
  WIDTHS.forEach((_, index) => {
    const size = el("button", { className: "draw-size", type: "button" });
    const dot = el("span", { className: "draw-dot" });
    dot.style.width = dot.style.height = `${6 + index * 5}px`;
    size.append(dot);
    size.dataset.on = String(index === brushWidth);
    size.onclick = () => {
      brushWidth = index;
      for (const other of sizes.children) other.dataset.on = "false";
      size.dataset.on = "true";
    };
    sizes.append(size);
  });

  const undoButton = el("button", {
    className: "draw-tool",
    type: "button",
    textContent: t("draw.undo"),
    onclick: () => send({ a: "undo" }),
  });
  const clearButton = el("button", {
    className: "draw-tool",
    type: "button",
    textContent: t("draw.clear"),
    onclick: () => send({ a: "clear" }),
  });
  // Swap this word for a fresh one, before the pen goes down. Its own toggle, not
  // the tools' one: the tools show all through drawing, but the skip is a reveal-only
  // "I can't draw this", so refreshControls hides it the moment the first stroke lands.
  const skipButton = el("button", {
    className: "draw-tool draw-skip",
    type: "button",
    onclick: () => send({ a: "skip" }),
  });
  const tools = el("div", { className: "draw-tools" }, [
    swatches,
    sizes,
    undoButton,
    clearButton,
    skipButton,
  ]);

  const stage = el("div", { className: "draw-stage" }, [canvasEl, tools]);

  // The sidebar: who is winning, the running chat of guesses, and your own box.
  const scores = el("ul", { className: "draw-scores" });
  const scoreRows = new Map();

  const log = el("ul", { className: "draw-log" });
  const logRows = new Map(); // guess id -> { row, correct }

  const guessInput = el("input", {
    className: "draw-guess-input",
    type: "text",
    autocomplete: "off",
    maxLength: 60,
  });
  const guessForm = el("form", { className: "draw-guess" }, [
    guessInput,
    el("button", {
      className: "primary",
      type: "submit",
      textContent: t("draw.guess_send"),
    }),
  ]);
  guessForm.onsubmit = (event) => {
    event.preventDefault();
    const text = guessInput.value.trim();
    if (text) send({ a: "guess", text });
    guessInput.value = "";
  };
  guessInput.placeholder = t("draw.guess_placeholder");

  // A one-line note where the input would be, for whoever is not guessing.
  const aside = el("p", { className: "draw-aside" });

  const sidebar = el("div", { className: "draw-sidebar" }, [
    scores,
    log,
    guessForm,
    aside,
  ]);

  root.replaceChildren(prompt, topbar, stage, sidebar);

  // -- the pen --------------------------------------------------------------

  function toGrid(event) {
    const box = canvasEl.getBoundingClientRect();
    const coord = latest?.coord ?? 1000;
    const x = Math.round(((event.clientX - box.left) / box.width) * coord);
    const y = Math.round(((event.clientY - box.top) / box.height) * coord);
    return [Math.max(0, Math.min(coord, x)), Math.max(0, Math.min(coord, y))];
  }

  function canDraw() {
    return (
      latest &&
      latest.drawer === me.sub &&
      (latest.phase === "reveal" || latest.phase === "drawing") &&
      !latest.over
    );
  }

  function penDown(event) {
    if (!canDraw()) return;
    event.preventDefault();
    canvasEl.setPointerCapture?.(event.pointerId);
    drawing = true;
    const point = toGrid(event);
    localStroke = { c: brushColour, w: brushWidth, p: [...point] };
    pending = [...point];
    lastSent = point;
    send({ a: "open", c: brushColour, w: brushWidth });
  }

  function penMove(event) {
    if (!drawing) return;
    event.preventDefault();
    const point = toGrid(event);
    // Only once the pen has actually travelled: a still finger must not pile a
    // thousand identical points onto the wire.
    if (
      lastSent &&
      Math.abs(point[0] - lastSent[0]) < STEP &&
      Math.abs(point[1] - lastSent[1]) < STEP
    ) {
      return;
    }
    lastSent = point;
    localStroke.p.push(point[0], point[1]);
    pending.push(point[0], point[1]);
  }

  function penUp(event) {
    if (!drawing) return;
    event.preventDefault();
    flush();
    drawing = false;
    // The server has the whole stroke now; stop painting the local copy over it.
    localStroke = null;
  }

  function flush() {
    if (pending.length) {
      send({ a: "pts", p: pending });
      pending = [];
    }
    lastFlush = performance.now();
  }

  canvasEl.addEventListener("pointerdown", penDown);
  window.addEventListener("pointermove", penMove);
  window.addEventListener("pointerup", penUp);
  window.addEventListener("pointercancel", penUp);

  // -- the paint loop -------------------------------------------------------
  //
  // Guarded exactly as _canvas.js is: a throw reschedules in a finally rather than
  // killing the loop for ever, and says so on the page.

  let frame = null;
  let broke = null;

  function fail(error) {
    if (broke) return;
    broke = el("p", { className: "hint broke" });
    broke.textContent = `renderer: ${error?.message ?? error}`;
    root.append(broke);
    console.error("renderer threw; the board will keep painting", error);
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const side = canvasEl.clientWidth;
    canvasEl.width = side * ratio;
    canvasEl.height = side * ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return side;
  }

  let side = resize();
  const onResize = () => {
    side = resize();
  };
  window.addEventListener("resize", onResize);

  function strokePath(stroke, scale) {
    const p = stroke.p;
    if (p.length < 2) return;
    context.strokeStyle = COLOURS[stroke.c] ?? COLOURS[0];
    context.lineWidth = Math.max(1, (WIDTHS[stroke.w] ?? WIDTHS[0]) * scale);
    context.beginPath();
    context.moveTo(p[0] * scale, p[1] * scale);
    for (let i = 2; i < p.length; i += 2) context.lineTo(p[i] * scale, p[i + 1] * scale);
    // A single tap is a dot: stroke a zero-length path so it still marks.
    if (p.length === 2) context.lineTo(p[0] * scale + 0.01, p[1] * scale);
    context.stroke();
  }

  function paint() {
    try {
      // Flush the pen on the render clock too, so a slow drag still trickles out
      // even between pointer events.
      if (drawing && pending.length && performance.now() - lastFlush > FLUSH_MS) {
        flush();
      }

      context.clearRect(0, 0, side, side);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, side, side);
      context.lineJoin = context.lineCap = "round";

      const coord = latest?.coord ?? 1000;
      const scale = side / coord;
      for (const stroke of latest?.strokes ?? []) strokePath(stroke, scale);
      if (localStroke) strokePath(localStroke, scale);
    } catch (error) {
      fail(error);
    } finally {
      frame = requestAnimationFrame(paint);
    }
  }
  frame = requestAnimationFrame(paint);

  // -- the DOM, mutated in place on each state ------------------------------

  function nameOf(game, sub) {
    return sub === me.sub ? t("ui.you") : (game.playerNames[sub] ?? sub);
  }

  function spaced(word) {
    return word.split("").join(" ");
  }

  function refreshPrompt(game) {
    const iAmDrawer = game.drawer === me.sub;
    const solved = game.solved.includes(me.sub);

    if (game.phase === "recap") {
      prompt.textContent = t("draw.the_word_was", { word: game.word });
      prompt.dataset.role = "recap";
    } else if (iAmDrawer) {
      prompt.textContent = t("draw.you_draw", { word: spaced(game.word) });
      prompt.dataset.role = "drawer";
    } else if (solved) {
      prompt.textContent = t("draw.you_got_it", { word: game.word });
      prompt.dataset.role = "solved";
    } else {
      prompt.textContent = spaced(game.mask);
      prompt.dataset.role = "guesser";
    }
  }

  function refreshTimer(game) {
    const seconds = Math.max(0, Math.ceil(game.remaining));
    roundLabel.textContent = t("draw.round", {
      round: game.round,
      rounds: game.rounds,
    });
    if (game.over) {
      timer.textContent = "";
    } else if (game.phase === "recap") {
      timer.textContent = t("draw.next_in", { n: seconds });
    } else {
      timer.textContent = t("draw.seconds", { n: seconds });
    }
    timer.dataset.low = String(!game.over && game.phase === "drawing" && seconds <= 10);
  }

  function refreshScores(game) {
    const subs = Object.keys(game.counts);
    // Rebuild only if the roster changed; otherwise update the numbers in place.
    if (subs.length !== scoreRows.size || subs.some((s) => !scoreRows.has(s))) {
      scores.replaceChildren();
      scoreRows.clear();
      for (const sub of subs) {
        const name = el("span", { className: "draw-score-name" });
        const value = el("span", { className: "draw-score-value" });
        const row = el("li", { className: "draw-score" }, [name, value]);
        if (sub === me.sub) row.dataset.me = "true";
        scores.append(row);
        scoreRows.set(sub, { row, name, value });
      }
    }
    for (const [sub, parts] of scoreRows) {
      parts.name.textContent = nameOf(game, sub);
      parts.value.textContent = String(game.counts[sub]);
      parts.row.dataset.drawer = String(sub === game.drawer);
      parts.row.dataset.solved = String(game.solved.includes(sub));
    }
  }

  function logRow(game, guess) {
    const row = el("li", { className: "draw-log-row" });
    row.dataset.correct = String(guess.correct);
    const name = el("span", { className: "draw-log-name" });
    name.textContent = nameOf(game, guess.who);
    row.append(name);

    if (guess.correct) {
      row.append(el("span", { className: "draw-log-tick", textContent: "✓" }));
    } else {
      row.append(el("span", { className: "draw-log-text", textContent: guess.text }));
      // Only the drawer, and only while the round is live, can wave a synonym through.
      if (game.drawer === me.sub && game.phase !== "recap" && !game.over) {
        row.append(
          el("button", {
            className: "draw-accept",
            type: "button",
            textContent: t("draw.accept"),
            onclick: () => send({ a: "accept", id: guess.id }),
          }),
        );
      }
    }
    return row;
  }

  function refreshLog(game) {
    // Reconcile the log against the guesses on the wire, keyed by id. Guess ids never
    // repeat, so a new round -- and a skip, which empties the round's guesses without
    // changing its number -- both show up as ids that have simply vanished, and their
    // rows are dropped. A guess whose `correct` flipped (the drawer waved it through)
    // is rebuilt in place, so the Accept turns into a tick on every screen, not just
    // the server's scoreboard.
    const present = new Set(game.guesses.map((g) => g.id));
    for (const [id, entry] of logRows) {
      if (!present.has(id)) {
        entry.row.remove();
        logRows.delete(id);
      }
    }
    for (const guess of game.guesses) {
      const entry = logRows.get(guess.id);
      if (!entry) {
        const row = logRow(game, guess);
        logRows.set(guess.id, { row, correct: guess.correct });
        log.append(row);
      } else if (entry.correct !== guess.correct) {
        const row = logRow(game, guess);
        entry.row.replaceWith(row);
        logRows.set(guess.id, { row, correct: guess.correct });
      }
    }
    log.scrollTop = log.scrollHeight;
  }

  function refreshControls(game) {
    const iAmDrawer = game.drawer === me.sub;
    const seated = game.seat !== null && game.seat !== undefined;
    const solved = game.solved.includes(me.sub);
    const live = game.phase === "reveal" || game.phase === "drawing";

    tools.dataset.on = String(iAmDrawer && live && !game.over);
    canvasEl.dataset.pen = String(canDraw());
    // Skip only exists in the reveal, and only while the drawer has one left. Its own
    // toggle: the rest of the tools stay up all through drawing.
    const canSkip =
      iAmDrawer && game.phase === "reveal" && (game.skips ?? 0) > 0 && !game.over;
    skipButton.dataset.on = String(canSkip);
    skipButton.textContent = t("draw.skip", { n: game.skips ?? 0 });
    // A row's Accept button is left in place when the round ends -- refreshLog only
    // rebuilds a row whose correctness changed. Gate the whole log instead: once it is
    // not the drawer's live round, every Accept still in it hides at once, in CSS.
    log.dataset.live = String(iAmDrawer && live && !game.over);

    const canGuess = seated && !iAmDrawer && !solved && live && !game.over;
    guessForm.dataset.on = String(canGuess);
    guessInput.disabled = !canGuess;

    // The note that stands in for the box when there is nothing to type.
    let note = "";
    if (game.over) note = "";
    else if (iAmDrawer && live) note = t("draw.you_are_drawing");
    else if (solved) note = t("draw.waiting_others");
    else if (game.phase === "recap") note = t("draw.round_over");
    else if (!seated) note = t("draw.spectating");
    aside.textContent = note;
    aside.dataset.on = String(Boolean(note));
  }

  return {
    update(game) {
      latest = game;
      if (game.status === "waiting") {
        prompt.textContent = t("draw.waiting_to_start");
        prompt.dataset.role = "waiting";
        topbar.dataset.on = "false";
        stage.dataset.on = "false";
        sidebar.dataset.on = "false";
        return;
      }
      topbar.dataset.on = stage.dataset.on = sidebar.dataset.on = "true";

      refreshPrompt(game);
      refreshTimer(game);
      refreshScores(game);
      refreshLog(game);
      refreshControls(game);
    },

    destroy() {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", penMove);
      window.removeEventListener("pointerup", penUp);
      window.removeEventListener("pointercancel", penUp);
    },
  };
}

// The status line. The board carries the timer and the word; this carries the
// round, the role, and the running score, so the two do not fight over the same
// fast-changing number.
export function describe(game, me) {
  // Not `!== "active"`: a finished game's status is "finished", and that would
  // swallow the game-over line.
  if (game.status === "waiting") return null;

  const score = Object.entries(game.counts)
    .map(([sub, n]) => `${sub === me.sub ? t("ui.you") : game.playerNames[sub]} ${n}`)
    .join(" - ");

  if (game.over) {
    if (game.draw) return `${score}. ${t("ui.draw")}`;
    return game.winner === me.sub
      ? `${score}. ${t("ui.you_won")}`
      : `${score}. ${t("ui.they_won", { name: game.playerNames[game.winner] })}`;
  }

  const round = t("draw.round", { round: game.round, rounds: game.rounds });
  const iAmDrawer = game.drawer === me.sub;

  if (game.phase === "recap") {
    return `${round}. ${t("draw.the_word_was", { word: game.word })}. ${score}.`;
  }

  const role = iAmDrawer
    ? t("draw.you_are_drawing")
    : t("draw.someone_draws", { name: game.playerNames[game.drawer] });
  return `${round}. ${role}. ${score}.`;
}
