// A readout, for when "it feels choppy" has to become a number.
//
// Off unless the page is loaded with ?debug. It is not a developer toy: it exists
// because the things that make a real-time game feel bad are indistinguishable
// from the sofa, and they have nothing to do with each other.
//
//   The BROWSER stopped painting.  60fps is the budget the whole design rests on,
//   and a tab that drops to 30, or hitches for 100ms, looks exactly like a network
//   problem and exactly like bad arithmetic. `fps` and `worst frame` are the only
//   things that can tell you it was neither.
//
//   The SERVER stopped sending.  `states/s` should sit on the tick rate and
//   `dropped` should stay at nought. If states go missing, the renderer falls back
//   to catching up down the body -- correct, but slower and later, and the game
//   will feel it.
//
//   The ARITHMETIC went wrong.  `speed` is the drawn snake's own pace, in cells
//   per tick, straight off the cells being painted. It should be 1.00 and it should
//   never spike: a spike IS the stutter, measured rather than described.
//
//   The INPUT never landed.  A press the server rejected (you tried to reverse) or
//   never got produces no turn at all, and the player reads that as lag. `ignored`
//   counts them. It must never be folded into the average instead -- a press with
//   no answer has no latency, and averaging it in reports a number that belongs to
//   nothing that happened.
//
// And `key -> turn` is the number for the other complaint. It times an actual
// keypress against the frame the head actually changed axis on -- so "control feels
// delayed" stops being a feeling and becomes a millisecond count that can be argued
// with. On a healthy 6 Hz line it should sit near half a tick, because a snake
// cannot turn in the middle of a cell and half a tick is what a LOCAL game costs.
//
// It reports at 5 Hz, deliberately. A readout that wrote to the DOM on every frame
// to tell you about frame times would be a fine way to cause the very stutter it
// is there to hunt.

const REPORT_MS = 200;
const WINDOW_MS = 1000; // how much history the live figures are drawn from

// A press with no turn behind it after this long was not slow, it was DROPPED --
// the server rejected it, or never saw it. Three ticks is well past the tick that
// should have answered it, and well short of an ordinary gap between presses.
const GIVE_UP_TICKS = 3;

export function enabled() {
  return new URLSearchParams(location.search).has("debug");
}

/**
 * Mount the readout under the board. Returns null when it is switched off, so
 * every call site is a `?.` and the game pays nothing for it being here.
 *
 * frame({now, delayMs, path, head, tickMs, dropped, stateAge}) -- once per paint.
 * pressed() -- a steering message actually WENT. Starts the key -> turn stopwatch.
 *              Do not call it for a press onChange() deduped away: nothing is
 *              coming back to answer it, so there is nothing to time.
 *
 * ONE CLOCK: `now` must be performance.now(), because that is what pressed() reads
 * when it starts the stopwatch. Hand frame() a different origin and key -> turn
 * measures the gap between two unrelated clocks, which is a large and very
 * convincing-looking number.
 */
export function readout(root, board = null) {
  if (!enabled()) return null;

  const box = document.createElement("div");
  box.className = "readout";

  const panel = document.createElement("pre");
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "readout-copy";
  copy.textContent = "Copy report";
  box.append(panel, copy);
  root.append(box);

  const paints = []; // every frame in the live window
  const moves = []; // the drawn snake's speed, in the live window
  const turns = []; // key -> turn, in ms, every one of them

  // The live figures are a one-second window, because that is what you watch while
  // you play. The report is the WHOLE session, because the thing you are hunting
  // probably happened thirty seconds ago and is not on screen any more.
  const all = { frames: 0, worstGap: 0, worstSpeed: 0, ahead: 0, behind: 0, surging: 0 };
  const gaps = []; // ms between one state landing and the next
  let lastArrival = null;
  let lastTick = null;
  let worstDelay = 0;
  let ignored = 0;

  let waitingFor = null;
  let axis = null;
  let previous = null;
  let reportedAt = 0;
  let latest = null;

  // -- the raw input, counted BEFORE the game gets a look at it ---------------
  //
  // "I had to press rematch before the touch controls worked" is three different
  // bugs and they need three different fixes, and nothing above can tell them
  // apart. So count the events as the BROWSER delivers them, not as the game
  // receives them:
  //
  //   touch 0            -- the finger never reached us at all. The listener is on
  //                         the wrong element, or was never bound, or something is
  //                         eating the gesture before it gets here.
  //   touch N, cancel N  -- iOS took the gesture back to scroll the page with it.
  //                         That is what pointercancel MEANS, and it is the classic
  //                         way a swipe dies silently on a phone.
  //   touch N, sent 0    -- we saw it and decided not to act: below the swipe
  //                         threshold, or deduped as the way we were already going.
  //   sent N, answered 0 -- it went, and the server threw it away.
  //
  // These listeners are passive and count only. They never preventDefault and never
  // steer: the readout must not become a control surface, or it changes the very
  // thing it is measuring.
  const raw = { touch: 0, move: 0, cancel: 0, keys: 0, sent: 0 };
  const stop = [];

  if (board) {
    const count = (element, type, bump) => {
      const on = () => bump();
      element.addEventListener(type, on, { passive: true });
      stop.push(() => element.removeEventListener(type, on));
    };
    count(board, "pointerdown", () => (raw.touch += 1));
    count(board, "pointermove", () => (raw.move += 1));
    count(window, "pointercancel", () => (raw.cancel += 1));
    count(window, "keydown", () => (raw.keys += 1));
  }

  const since = (list, now) => {
    while (list.length && now - list[0].at > WINDOW_MS) list.shift();
    return list;
  };
  const median = (xs) =>
    xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0;
  const pct90 = (xs) =>
    xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)] : 0;

  // The report is the thing worth having, and copying it is the thing that has to
  // work -- including on http://some-box:8080, where navigator.clipboard does not
  // exist at all. A page served over plain http is not a secure context, so the
  // Clipboard API is simply absent, and a copy button that only knows about it is
  // a copy button that silently does nothing on exactly the machine you are
  // debugging. Hence the execCommand fallback, deprecated and still the only thing
  // that works here, and hence selecting the text as a last resort so Ctrl-C can.
  async function toClipboard(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return "Copied";
      }
    } catch {
      // fall through: permissions, or an insecure context that lies about having it
    }

    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.append(scratch);
    scratch.select();
    try {
      const ok = document.execCommand("copy");
      scratch.remove();
      if (ok) return "Copied";
    } catch {
      scratch.remove();
    }

    // Nothing worked. Leave it selected on screen so the keyboard can do it.
    const range = document.createRange();
    range.selectNodeContents(panel);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return "Selected -- press Ctrl-C";
  }

  function report() {
    const answered = turns.length;
    const lines = [
      `waiting-games snake ?debug`,
      ``,
      `tick rate     ${latest ? (1000 / latest.tickMs).toFixed(1) : "?"} Hz` +
        ` (${latest ? latest.tickMs.toFixed(0) : "?"}ms)`,
      `session       ${(all.frames / 60).toFixed(0)}s, ${all.frames} frames painted`,
      ``,
      `-- the browser`,
      `worst frame   ${all.worstGap.toFixed(0)}ms   (60fps budget is 17ms)`,
      ``,
      `-- the wire`,
      `dropped       ${latest?.dropped ?? 0} states`,
      `drawn         live ${all.ahead} frames / catching up ${all.behind} frames`,
      `delay         worst ${worstDelay.toFixed(0)}ms`,
      ``,
      `-- the arithmetic`,
      `speed         worst ${all.worstSpeed.toFixed(2)} cells/tick (1.00 is correct)`,
      ``,
      `surging       ${all.frames ? ((100 * all.surging) / all.frames).toFixed(0) : 0}% of frames ran >1.1x (rubber-banding)`,
      ``,
      `-- the connection (what everything above is tuned against)`,
      `state gaps    median ${gaps.length ? median(gaps).toFixed(0) : "-"}ms  ` +
        `p90 ${gaps.length ? pct90(gaps).toFixed(0) : "-"}ms  worst ${gaps.length ? Math.max(...gaps).toFixed(0) : "-"}ms` +
        `   (a tick is ${latest ? latest.tickMs.toFixed(0) : "?"}ms)`,
      ``,
      `-- the input`,
      `raw           touch ${raw.touch} down, ${raw.move} moves, ${raw.cancel} CANCELLED` +
        `  |  keys ${raw.keys}  |  sent ${raw.sent}`,
      `key -> turn   ${answered} answered: ` +
        (answered ? turns.map((t) => `${t.toFixed(0)}ms`).join(" ") : "none"),
      `              mean ${answered ? Math.round(turns.reduce((a, b) => a + b, 0) / answered) : "-"}ms` +
        `, median ${answered ? median(turns).toFixed(0) : "-"}ms`,
      `ignored       ${ignored} presses went out and got no turn at all`,
      ``,
      `screen        ${window.devicePixelRatio}x, ${window.innerWidth}x${window.innerHeight}`,
      `agent         ${navigator.userAgent}`,
    ];
    return lines.join("\n");
  }

  copy.addEventListener("click", async () => {
    copy.textContent = await toClipboard(report());
    setTimeout(() => {
      copy.textContent = "Copy report";
    }, 2000);
  });

  return {
    pressed() {
      // Only the FIRST press of a turn is timed. Hammering the keys would
      // otherwise restart the stopwatch and report a latency of nothing.
      raw.sent += 1;
      if (waitingFor === null) waitingFor = performance.now();
    },

    // A state landed. The GAPS between these are the connection's real character,
    // and they are what everything else here is tuned against -- so they had better
    // be measured on the machine that has the problem, and not modelled by somebody
    // who does not. A laptop on ethernet delivers a metronome. A phone on wifi naps
    // and flushes, and the difference between those two is the whole argument.
    arrived(now, tick) {
      if (tick === lastTick) return;
      lastTick = tick;
      if (lastArrival !== null) gaps.push(now - lastArrival);
      lastArrival = now;
    },

    frame({ now, delayMs, path, head, tickMs, dropped, stateAge }) {
      latest = { tickMs, dropped, stateAge };
      paints.push({ at: now });

      all.frames += 1;
      if (path === "live") all.ahead += 1;
      else all.behind += 1;
      worstDelay = Math.max(worstDelay, delayMs);

      // A press nothing ever answered. It was not slow -- it never landed, and
      // folding it into the average would report a wait that belongs to no press
      // at all. Count it instead: input being thrown away is its own bug, and it
      // is the one that feels most like lag.
      if (waitingFor !== null && now - waitingFor > GIVE_UP_TICKS * tickMs) {
        ignored += 1;
        waitingFor = null;
      }

      if (previous) {
        const dx = head[0] - previous.x;
        const dy = head[1] - previous.y;
        const gap = now - previous.at;

        all.worstGap = Math.max(all.worstGap, gap);

        if (gap > 0) {
          // Cells per tick: 1.00 is correct, whatever the tick rate is.
          const speed = (Math.hypot(dx, dy) / gap) * tickMs;
          moves.push({ at: now, speed });
          all.worstSpeed = Math.max(all.worstSpeed, speed);
          // Rubber-banding: the snake running visibly fast to pay off a hold. It is
          // the price of NOT being blind, and it has to be counted, because the
          // trade between the two is the only decision left to make here.
          if (speed > 1.1) all.surging += 1;
        }

        // The turn has landed on screen the moment the head starts moving on the
        // other axis. That is what the player is actually waiting to see.
        if (Math.hypot(dx, dy) > 1e-9) {
          const moving = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          if (axis !== null && moving !== axis && waitingFor !== null) {
            turns.push(now - waitingFor);
            waitingFor = null;
          }
          axis = moving;
        }
      }
      previous = { x: head[0], y: head[1], at: now };

      if (now - reportedAt < REPORT_MS) return;
      reportedAt = now;

      const frames = since(paints, now);
      const speeds = since(moves, now).map((m) => m.speed);

      // The worst GAP between paints, not the average. An average of 60fps with
      // one 120ms hole in it is not 60fps, and the hole is the thing you saw.
      let worstGap = 0;
      for (let i = 1; i < frames.length; i += 1) {
        worstGap = Math.max(worstGap, frames[i].at - frames[i - 1].at);
      }

      const fps = frames.length / (WINDOW_MS / 1000);
      const recent = turns.slice(-8);
      const mean = recent.length
        ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length)
        : null;

      panel.textContent = [
        `fps         ${fps.toFixed(0).padStart(5)}   worst frame ${worstGap.toFixed(0)}ms`,
        `speed       ${median(speeds).toFixed(2).padStart(5)}   worst ${Math.max(0, ...speeds).toFixed(2)} cells/tick`,
        `states/s    ${(1000 / tickMs).toFixed(1).padStart(5)}   dropped ${dropped}   age ${(stateAge ?? 0).toFixed(0)}ms`,
        `delay       ${delayMs.toFixed(0).padStart(5)}ms  drawn ${path}`,
        `key -> turn ${recent.length ? `${recent[recent.length - 1].toFixed(0)}`.padStart(5) : "    -"}ms  mean ${mean ?? "-"}ms  ignored ${ignored}`,
        `input       touch ${raw.touch}  cancel ${raw.cancel}  keys ${raw.keys}  sent ${raw.sent}`,
      ].join("\n");
    },

    destroy() {
      for (const off of stop) off();
      box.remove();
    },
  };
}
