// Sliding a smooth game between the states the server has agreed on -- including
// the one it has agreed on but not yet reached.
//
// DOM-free, so it can be unit-tested -- the same reason _geometry.js exists.
// Pong's rotation maths was silently wrong for two of its four walls, and it
// stayed wrong because nothing could test it without a browser. This is the same
// shape of code: a small piece of arithmetic that is either right or subtly,
// invisibly wrong, and "the snake looks a bit odd" is not a bug report anyone
// can act on.
//
// -- the cell of lag, and where it went -------------------------------------
//
// To slide a snake from one cell to the next you need both cells, and the far one
// belongs to a tick that has not happened. So the renderer waited for it, and
// drew the world a tick in the past -- which in a game that moves exactly one
// cell per tick is a WHOLE CELL of lag, at every tick rate there is. You were
// steering the snake you could see, and it was not the snake the server had.
//
// That is why slowing the snake down did not make it easier to steer, and could
// not: the lag was a tick, a tick is a cell, and the cell does not care how long
// the tick lasts.
//
// So the server stopped making us wait. It decides each move a tick before it
// makes it and sends it with the state -- `next`, the cell the head is about to
// take (see snake.py). The far cell is no longer in the future; it is in our
// hands. We draw the move AS IT HAPPENS, in real time, and the drawn snake is
// where the server's snake is.
//
// -- what the buffer is still for -------------------------------------------
//
// Not smoothness. A state that arrives late no longer costs anything: the slide
// finishes ON the cell the server told us it would finish on, and holds there
// until the state confirms it. A hold is invisible at 20ms of wifi jitter, and --
// unlike the jump this used to be -- it is never wrong.
//
// What still hurts is a state that never comes at all. lobby.stream() drops a
// frame at any socket still busy with the last one, on purpose, and a dropped
// state takes the NEXT move with it: we finish the move we knew about, and then
// we are blind. Only that costs delay, only while it is happening, and `gap`
// below buys exactly as much as it costs and gives it straight back. A clean line
// pays nothing, which is the whole point.
//
// -- and why the snake carries its own history ------------------------------
//
// THE BODY IS THE PATH, in both directions. The body is a queue: every tick the
// head pushes onto the front, so cells[i + 1] is where segment i stood a tick ago
// and cells[i - 1] is where it will stand next. That is what makes a dropped state
// survivable -- a segment walks its own body back through every cell it crossed,
// so it never cuts a corner -- and it is why `next` is needed for the head alone.
// Everything behind the head already knows where it is going.

// The most delay a PLAYER can be asked to pay, whatever the connection is doing.
//
// This used to be six ticks -- a full second -- chosen by asking how bad a line
// could get. That is the wrong question, and a phone answered it: on a radio that
// sleeps and flushes, the delay climbed to 826ms and stayed there, and 826ms of
// render delay is not lag, it is BLINDNESS. You steer a snake that crashed a
// second ago. The bug report was "I died before I saw the snake hit the wall",
// and that is exactly what the renderer was built to do.
//
// So the bound is set by what a player can stand, not by what a network can do.
// One tick. Past that, holding on the cell and catching up afterwards is better
// than being shown the past -- a snake that stutters can still be steered, and a
// snake you are watching from a second ago cannot be steered at all.
//
// On a connection that delivers in clumps you cannot have both low latency and
// smooth motion. Something has to give, and it is not going to be the steering.
const MAX_DELAY_TICKS = 1;

// How fast the render clock may run to pay off a hold. Coming off a hold, the
// world is behind and has to catch up -- and cashing that in on one frame is a
// JUMP, which is the thing this file exists to prevent. So walk it back instead:
// a little faster than real time until it rejoins, and never faster than this.
//
// It is what lets the delay above be small. Without it, the only way to never
// lurch is to never be behind, and the only way to never be behind is to buy the
// delay up front -- which is how a second of it got bought.
const CATCHUP = 1.5;

// Past THIS much lateness the origin estimate is broken rather than the network.
// Different question, different number -- see the re-anchor in accept().
const STALE_TICKS = 6;

// How much history to keep: enough to walk back across the worst gap we will
// ever draw across.
const KEEP = STALE_TICKS + 3;

// How fast the delay forgets. It grows INSTANTLY -- a jump you have already drawn
// cannot be un-drawn -- and shrinks over a couple of seconds.
//
// It used to shrink at 0.995 a packet, which at 6 Hz is a half-life of TWENTY-THREE
// SECONDS: one bad moment in the first few seconds taxed the entire game, and a
// player watched `key -> turn` climb from 200ms to 450ms and stay there. A delay
// that outlives the round that caused it is a ratchet. This heals in about three
// seconds, which is short enough to be forgiven and long enough not to oscillate --
// and it is safe to be this quick now, because CATCHUP smooths the shrinking.
const FORGET = 0.96;

// A delay smaller than this is not a delay. See settle().
const SETTLE_MS = 5;

// Only used when the server has not said how fast it ticks.
const ASSUMED_TICK_MS = 125;

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), high);
}

/**
 * A buffer of server states, and a clock that reads the world out of it.
 *
 * accept(state, tick, now) -- a state arrived, carrying the server's tick index.
 * read(now)                -- the moment to draw, or null.
 *
 * read() hands back one of two things, and the caller does not have to care
 * which: a moment BETWEEN two states it holds (`span` ticks of travel, walked
 * backwards down the body) or a moment INSIDE the move the newest state says is
 * coming (`ahead`, walked forwards into `next`). The second is the normal case on
 * a healthy connection. The first is how a dropped state gets caught up on.
 */
export function timeline(tickHz) {
  const tickMs = tickHz ? 1000 / tickHz : ASSUMED_TICK_MS;
  const states = []; // {tick, state}, ascending

  // The local time at which tick 0 would have arrived, had every state come
  // down the wire with no delay at all. Every arrival votes on it.
  let origin = null;
  let newest = null;

  // What the connection has cost us lately, in ticks.
  //
  // `gap` is the widest hole in the tick sequence: a state that never arrives
  // takes the next move with it, and until the one after lands there is nothing
  // to draw forwards into.
  //
  // `late` is how far behind the ideal an arrival was, and it is the jitter, paid
  // for exactly. Holding on a cell we have not had confirmed is free -- it is
  // where the snake really is -- but COMING OFF that hold is not: the render clock
  // has been pinned while real time ran on, and the moment the state lands the
  // clamp opens and it would lurch forward to catch up. That is the old stall-then-
  // jump wearing a different hat, and half a tick of slack bought up front against
  // it is how this file used to answer. It does not need to be a guess. Trail real
  // time by what the line is actually costing us and the clamp never binds: on a
  // clean line that is nought, on a wobbly one it is the wobble, and never more.
  let gap = 1;
  let late = 0;

  // Never used to draw anything: these only tell on the connection. A browser
  // that has stopped painting, a server that has stopped sending, and arithmetic
  // that has gone wrong are three different bugs, and from the sofa all three
  // look exactly like "it feels choppy". See _debug.js.
  let dropped = 0;
  let arrived = null;

  // Where we last DREW -- which is not always where we wanted to be. Time must
  // not run backwards (re-anchoring origin to a faster path would otherwise
  // rewind the world), and just as importantly, a moment we could not draw is a
  // moment we must not later pretend we had.
  let last = null;
  let lastAt = null; // ...and when, so a hold can be walked off rather than cashed in

  function delayTicks() {
    // Nought on a clean line, and nought is not a floor we are choosing to sit
    // on: once the far cell is on the wire there is genuinely nothing left to
    // wait for. Every tick of this is a tick some connection actually charged us
    // -- and never more than one, however much it charges. See MAX_DELAY_TICKS.
    return clamp(gap - 1 + late, 0, MAX_DELAY_TICKS);
  }

  // Below a few milliseconds there is nothing left to give back. The decay is an
  // asymptote, so without this the game stays imperceptibly, permanently laggier
  // after one bad packet -- a ratchet, however small the teeth are.
  //
  // In MILLISECONDS, because that is what a delay too small to perceive is
  // measured in. Everything else here is in ticks, and a tick is not a fixed
  // amount of time: expressing this one in ticks is how the last of these
  // constants came to mean 62ms at one tick rate and 83ms at another.
  const settle = (ticks) => (ticks * tickMs < SETTLE_MS ? 0 : ticks);

  return {
    accept(state, tick, now) {
      if (newest !== null && tick <= newest) return; // stale or a re-send

      // An arrival that beats every previous one defines the fastest path we
      // have seen; anything slower is lateness, not a new clock. Let origin
      // drift towards the slow side very gently, so a genuinely skewing clock is
      // followed and a single early packet does not pin us forever.
      const ideal = now - tick * tickMs;
      if (origin === null || ideal < origin) origin = ideal;
      else origin += (ideal - origin) * 0.002;

      let lateness = (now - (origin + tick * tickMs)) / tickMs;

      // ...but origin is a min(), and a min NEVER FORGETS. One sample taken at the
      // wrong moment pins it for the rest of the session, and there is a sample
      // taken at the wrong moment in every game anybody actually plays: the state
      // pushed while the board sits in the LOBBY carries tick 0, because a
      // real-time game reports its clock whether or not the clock is running. Sit
      // there for ten seconds deciding, press Start, and every tick that follows
      // measures as ten seconds late against an origin ten seconds too early --
      // and the drift above gives it back at 0.2% a packet, which is to say never.
      //
      // What that looks like is not lag. `late` pins to the ceiling, the render
      // clock runs permanently past the newest state, the clamp in read() holds it
      // at alpha = 1 -- and alpha = 1 draws the snake ON the cell it is travelling
      // to, every frame, and never once between two cells. The interpolation does
      // not break. It silently stops happening, and the snake teleports a whole
      // cell six times a second on a stream that is otherwise perfect.
      //
      // So: nothing can be later than the ceiling. Past that we would be holding
      // anyway, so the delay buys nothing -- and a packet that claims to be later
      // than the game can be played is not a late packet, it is a broken estimate.
      // Believe the packet, not the estimate, and start again from here.
      if (lateness > STALE_TICKS) {
        origin = ideal;
        lateness = 0;
        late = 0;
      }

      const hole = newest === null ? 1 : tick - newest;

      late = settle(Math.max(lateness, late * FORGET));
      gap = 1 + settle(Math.max(hole, 1 + (gap - 1) * FORGET) - 1);

      dropped += hole - 1;
      arrived = now;

      states.push({ tick, state });
      newest = tick;

      // Two states either side of the render point is all that is ever drawn.
      // Keep a little history for a delay that has just grown, and no more.
      while (states.length > KEEP) states.shift();
    },

    read(now) {
      if (origin === null || states.length === 0) return null;

      // Real time, in ticks, less whatever the connection is charging us today.
      // Nought on a clean line: the move in flight is one the server has already
      // committed to, so there is nothing to wait for.
      let want = (now - origin) / tickMs - delayTicks();

      // ...but never past the end of the move we were told about. Beyond that we
      // would be guessing at a tick the server has not decided, and the whole
      // point of `next` is that we no longer have to. Hold on the cell instead --
      // which is exactly where the state, when it lands, will say the snake is.
      want = Math.min(want, newest + 1);

      if (last !== null) {
        if (want < last) {
          want = last; // never rewind
        } else {
          // Never LURCH, either. We may be behind -- a state was late, or the
          // delay just shrank -- and the whole deficit is sitting there waiting to
          // be cashed in on the very next frame, which is a jump, which is the one
          // thing this file exists to prevent. Walk it back instead: a little
          // faster than real time until the world rejoins itself.
          //
          // This is what pays for a small MAX_DELAY_TICKS. Without it the only way
          // never to lurch is never to be behind, and the only way never to be
          // behind is to buy the delay up front -- which is how a phone came to be
          // rendering a second in the past.
          const elapsed = (now - lastAt) / tickMs;
          want = Math.min(want, last + elapsed * CATCHUP);
        }
      }
      last = want;
      lastAt = now;

      // The normal case: inside the move the newest state told us was coming.
      if (want > newest) {
        const entry = states[states.length - 1];
        return { state: entry.state, alpha: want - entry.tick, ahead: true };
      }

      // Catching up on a state that never arrived. We are behind the newest one
      // and walking towards it down the body -- see at().
      let before = null;
      let after = null;
      for (const entry of states) {
        if (entry.tick <= want) before = entry;
        else if (after === null) after = entry;
      }

      if (before === null) {
        last = states[0].tick;
        lastAt = now;
        return { state: states[0].state, alpha: 1, span: 0 };
      }
      if (after === null) {
        last = before.tick;
        lastAt = now;
        return { state: before.state, alpha: 1, span: 0 };
      }

      const span = after.tick - before.tick; // ticks of travel, usually 1
      const alpha = clamp((want - before.tick) / span, 0, 1);

      // `after` alone is enough to draw with -- see at(). The state we are
      // sliding TOWARDS carries its own history in its body, so `before` is not
      // returned: reading the path out of the body is what stops a snake cutting
      // the corner when a state went missing.
      return { state: after.state, alpha, span };
    },

    // For tests, and for anyone wondering why the game feels a step behind.
    debug(now = null) {
      return {
        delayTicks: delayTicks(),
        gap,
        held: states.length,
        dropped,
        tickMs,
        // How stale the newest state is. On a healthy line this sits under one
        // tick and never grows: if it climbs, the server has stopped talking and
        // no amount of renderer is going to help.
        stateAge: now !== null && arrived !== null ? now - arrived : null,
      };
    },
  };
}

// Where segment `index` should be drawn, `alpha` of the way through a slide that
// covers `span` ticks of travel BACKWARDS -- from where it was, to where the state
// in hand says it is.
//
// This is the catch-up path. If a state never arrived, span is 2 and segment i has
// two cells to cover -- and we walk it through cells[i+2], cells[i+1], cells[i],
// one leg at a time. Sliding straight from cells[i+2] to cells[i] instead would
// CUT THE CORNER: if the snake turned during the tick we never saw, the straight
// line between the endpoints is a diagonal, and a snake drawn on a diagonal slices
// through the corner of a wall, or through its own neck. Off-grid, that is a
// smear; on a grid, it is a lie about the rules.
//
// Two cases have no history to walk back through, and both must SNAP instead:
//
//   - A snake that has just eaten is longer, so its final segments did not exist
//     a tick ago. Sliding one in from nowhere would stretch the snake across the
//     board.
//   - A snake nobody has seen before, and a dead one, which is not going
//     anywhere: span is 0 and the answer is simply where it is.
//
// Returning the cell itself is not a special case so much as the honest answer:
// with nothing to interpolate from, the only place we know it is, is where it is.
export function at(snake, index, alpha, span = 1) {
  const here = snake.cells[index];
  if (span < 1) return here;

  // The path, oldest cell first: where it was `span` ticks ago, ... , where it is.
  const path = [];
  for (let back = span; back >= 0; back -= 1) {
    const cell = snake.cells[index + back];
    if (!cell) return here; // no history that far back: it has grown, or it is new
    path.push(cell);
  }

  // How far along that path we are, in whole cells travelled plus a fraction.
  const travelled = clamp(alpha, 0, 1) * span;
  const leg = Math.min(Math.floor(travelled), span - 1);
  const step = travelled - leg;

  const from = path[leg];
  const to = path[leg + 1];
  return [from[0] + (to[0] - from[0]) * step, from[1] + (to[1] - from[1]) * step];
}

// Where segment `index` should be drawn, `alpha` of the way through the move the
// server has told us is coming. The same walk as at(), forwards.
//
// The body is a queue, so every segment takes the place of the one ahead of it:
// segment i is going to cells[i - 1], and it needs nothing from the wire to know
// that. Only the HEAD has nothing in front of it to read, and that is the one cell
// the server sends -- `next`. So this is not a prediction. There is nothing here
// we are guessing at.
//
// Two snakes do not move, and both simply stay where they are:
//
//   - One whose next move kills it. `next` is null, and the engine agrees: a snake
//     dies WITHOUT moving, so it stops on the last cell it legally stood on rather
//     than sliding into the wall and being yanked back out of it.
//   - A dead one. Same thing, one tick later.
export function ahead(snake, index, alpha) {
  const here = snake.cells[index];

  // Nothing moves, not just the head. A snake dies WITHOUT moving -- the engine
  // leaves every one of its cells alone on the tick it kills it -- so a body that
  // slid on behind a head that had stopped would stretch the snake by a cell and
  // then concertina it back when the state landed.
  if (!snake.alive || !snake.next) return here;

  const next = index === 0 ? snake.next : snake.cells[index - 1];
  if (!next) return here;

  // A growing snake keeps its tail: the server does not pop it, so the last
  // segment does not move at all this tick. Slide it anyway and the snake is
  // drawn a cell short until the state lands and puts it back -- a tail that
  // flickers once per apple, every apple.
  if (snake.grows && index === snake.cells.length - 1) return here;

  const step = clamp(alpha, 0, 1);
  return [here[0] + (next[0] - here[0]) * step, here[1] + (next[1] - here[1]) * step];
}
