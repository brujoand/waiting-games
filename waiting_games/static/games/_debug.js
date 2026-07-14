// A readout, for when "it feels choppy" has to become a number.
//
// Off unless the page is loaded with ?debug. It is not a developer toy: it exists
// because the three things that make a real-time game feel bad are indistinguish-
// able from the sofa, and they have nothing to do with each other.
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
// And `key -> turn` is the one number for the other complaint. It times an actual
// keypress against the frame the head actually changed axis on -- so "control feels
// delayed" stops being a feeling and becomes a millisecond count that can be argued
// with. On a healthy 6 Hz line it should sit near half a tick, because a snake
// cannot turn in the middle of a cell and half a tick is what a LOCAL game costs.
//
// It reports at 5 Hz, deliberately. A readout that wrote to the DOM on every frame
// to tell you about frame times would be a fine way to cause the very stutter it
// is there to hunt.

const REPORT_MS = 200;
const WINDOW_MS = 1000; // how much history each figure is drawn from

export function enabled() {
  return new URLSearchParams(location.search).has("debug");
}

/**
 * Mount the readout under the board. Returns null when it is switched off, so
 * every call site is a `?.` and the game pays nothing for it being here.
 *
 * frame({now, delayMs, path, head, tickMs, dropped, stateAge}) -- once per paint.
 * pressed() -- the player asked to turn. Starts the key -> turn stopwatch.
 *
 * ONE CLOCK: `now` must be performance.now(), because that is what pressed() reads
 * when it starts the stopwatch. Hand frame() a different origin and key -> turn
 * measures the gap between two unrelated clocks, which is a large and very
 * convincing-looking number.
 */
export function readout(root) {
  if (!enabled()) return null;

  const element = document.createElement("pre");
  element.className = "readout";
  root.append(element);

  const paints = []; // {at} of every frame in the window
  const moves = []; // {at, speed} of the drawn snake
  const turns = []; // key -> turn, in ms

  let waitingFor = null; // a press we have not yet seen answered on screen
  let axis = null;
  let previous = null;
  let reportedAt = 0;

  const since = (list, now) => {
    while (list.length && now - list[0].at > WINDOW_MS) list.shift();
    return list;
  };

  return {
    pressed() {
      // Only the FIRST press of a turn is timed. Hammering the keys would
      // otherwise restart the stopwatch and report a latency of nothing.
      if (waitingFor === null) waitingFor = performance.now();
    },

    frame({ now, delayMs, path, head, tickMs, dropped, stateAge }) {
      paints.push({ at: now });

      if (previous) {
        const dx = head[0] - previous[0];
        const dy = head[1] - previous[1];
        const gap = now - previous.at;

        if (gap > 0) {
          // Cells per tick: 1.00 is correct, whatever the tick rate is.
          moves.push({ at: now, speed: (Math.hypot(dx, dy) / gap) * tickMs });
        }

        // The turn has landed on screen the moment the head starts moving on the
        // other axis. That is what the player is actually waiting to see.
        const moving = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (Math.hypot(dx, dy) > 1e-9) {
          if (axis !== null && moving !== axis && waitingFor !== null) {
            turns.push(now - waitingFor);
            if (turns.length > 8) turns.shift();
            waitingFor = null;
          }
          axis = moving;
        }
      }
      previous = { 0: head[0], 1: head[1], at: now };

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
      const worstSpeed = speeds.length ? Math.max(...speeds) : 0;
      const median = speeds.length
        ? [...speeds].sort((a, b) => a - b)[Math.floor(speeds.length / 2)]
        : 0;
      const turn = turns.length ? turns[turns.length - 1] : null;
      const typical = turns.length
        ? Math.round(turns.reduce((a, b) => a + b, 0) / turns.length)
        : null;

      element.textContent = [
        `fps         ${fps.toFixed(0).padStart(5)}   worst frame ${worstGap.toFixed(0)}ms`,
        `speed       ${median.toFixed(2).padStart(5)}   worst ${worstSpeed.toFixed(2)} cells/tick`,
        `states/s    ${(1000 / tickMs).toFixed(1).padStart(5)}   dropped ${dropped}   age ${(stateAge ?? 0).toFixed(0)}ms`,
        `delay       ${delayMs.toFixed(0).padStart(5)}ms  drawn ${path}`,
        `key -> turn ${turn === null ? "    -" : `${turn.toFixed(0).padStart(5)}`}ms  mean ${typical ?? "-"}ms`,
      ].join("\n");
    },

    destroy() {
      element.remove();
    },
  };
}
