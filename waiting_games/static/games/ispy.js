// I Spy.
//
// The board is out of the window, so the screen is mostly a viewfinder: the card
// at the top says what to find, the camera fills the rest, and a box snaps onto
// the thing when the detector sees it.
//
// The DOM here is built ONCE and then edited in place, which is not how the other
// renderers work -- they rebuild on every state. They can afford to; a <video> tag
// cannot. Replacing it would tear down the camera stream and put the permission
// prompt back up, several times a round.

import { t } from "../i18n.js";
import { CONFIDENT, camera, capture, colourIn, detector } from "./_vision.js";

// The detector runs about ten times a second, so five frames agreeing is half a
// second of agreement. Enough to throw out a single flickering frame that thought
// the bin was a dog, short enough that the lock still feels like it happened when
// you pointed at the dog.
const LOCK = 5;
const HUNT_MS = 100;

// A claim the server refuses -- a photo that came out too big, a round that ended
// underneath us -- arrives as a toast, not as anything this renderer can see. So
// rather than wire the error back, a claim that has changed nothing after this long
// is simply forgotten, and the hunt picks up where it left off.
const CLAIM_TIMEOUT_MS = 3000;

export function create({ root, me, send }) {
  root.className = "board-ispy";

  const card = el("p", "ispy-card");
  const fault = el("p", "ispy-fault");
  const viewfinder = el("div", "ispy-view");
  const boxes = document.createElement("canvas");
  boxes.className = "ispy-boxes";
  const meter = el("div", "ispy-meter");
  const bar = el("i", "ispy-bar");
  meter.append(bar);
  viewfinder.append(boxes, meter);

  const give = document.createElement("button");
  give.className = "ispy-pass";
  give.onclick = () => send({ pass: true });

  const table = el("ul", "ispy-table");
  const last = el("figure", "ispy-last");
  const gallery = el("div", "ispy-gallery");

  root.replaceChildren(card, fault, viewfinder, give, table, last, gallery);

  let game = null;
  let eye = null; // the camera: { video, stop }
  let seeing = null; // the detector
  let broken = null; // an i18n code, if the camera or the detector would not start
  let booting = false;

  let alive = true;
  let frame = null;

  // Per round. `claimed` is what stops a lock firing over and over into the wire
  // while the state that would have stopped it is still in flight.
  let round = null;
  let hits = 0;
  let claimed = 0;
  let looked = 0;
  let latest = []; // every box the last look found, for the overlay
  let found = null; // ...and which of them is the thing we are after, if any

  // -- the camera, opened late ------------------------------------------------
  //
  // Not in create(): a SPECTATOR must never be asked for their camera. They came to
  // watch, they have nothing to find, and a permission prompt for a game you are not
  // playing is the kind of thing that gets an app closed. So the first state that
  // says we have a seat is what opens it.

  async function boot() {
    booting = true;
    try {
      eye = await camera();
    } catch (error) {
      broken = error.message === "insecure" ? "ispy.needs_https" : "ispy.no_camera";
      paint();
      return;
    }

    // destroy() may have run while we were waiting on the permission prompt, which
    // is a dialog and can sit there for a minute. Nothing below is mounted any more.
    if (!alive) {
      eye.stop();
      return;
    }
    viewfinder.prepend(eye.video);

    try {
      seeing = await detector();
    } catch {
      // Almost always a checkout that has never run scripts/fetch-detector.sh, so
      // /static/vendor is not there to be loaded.
      broken = "ispy.no_detector";
      paint();
      return;
    }

    if (!alive) return;
    paint();
    frame = requestAnimationFrame(hunt);
  }

  // -- the hunt ---------------------------------------------------------------

  function hunting() {
    return (
      alive &&
      eye &&
      seeing &&
      game &&
      !game.over &&
      game.target &&
      game.seat !== null &&
      !game.passed.includes(me.sub) &&
      !(claimed && performance.now() - claimed < CLAIM_TIMEOUT_MS)
    );
  }

  function hunt() {
    if (!alive) return;
    frame = requestAnimationFrame(hunt);

    const now = performance.now();
    if (now - looked >= HUNT_MS && hunting()) {
      looked = now;
      consider(now);
    }
    overlay();
  }

  function consider(now) {
    try {
      // Timestamps must climb, and performance.now() does.
      latest = seeing.detectForVideo(eye.video, now).detections ?? [];
    } catch {
      // A frame the detector could not read -- the camera was still waking up, the
      // tab went to the background. There is nothing to do about one of those but
      // look again in a tenth of a second.
      return;
    }

    found = latest.find((seen) => matches(seen, game.target)) ?? null;
    hits = found ? hits + 1 : 0;

    bar.style.width = `${Math.min(100, (hits / LOCK) * 100)}%`;

    if (hits >= LOCK) {
      claimed = now;
      hits = 0;
      send({
        found: {
          thing: game.target.thing,
          colour: game.target.colour ?? null,
          // The frame we were sure about, and the one everybody else will see.
          photo: capture(eye.video),
        },
      });
    }
  }

  function matches(detection, target) {
    const best = detection.categories?.[0];
    if (!best || best.categoryName !== target.thing) return false;
    if (best.score < CONFIDENT) return false;
    // The detector knows no adjectives, so the colour is ours to work out -- and
    // only ever for the one box that is already the right noun. It is a canvas
    // readback, and doing it for every box in the frame would cook the phone.
    if (!target.colour) return true;
    return colourIn(eye.video, detection.boundingBox) === target.colour;
  }

  // -- the overlay ------------------------------------------------------------

  function overlay() {
    if (!eye) return;
    const { videoWidth: width, videoHeight: height } = eye.video;
    if (!width) return; // the first frames, before the stream has a size

    // The canvas works in the VIDEO's pixels and css scales it to fit, so a
    // bounding box needs no arithmetic to land where the thing actually is.
    if (boxes.width !== width) {
      boxes.width = width;
      boxes.height = height;
    }

    const context = boxes.getContext("2d");
    context.clearRect(0, 0, width, height);
    if (!hunting()) return;

    for (const seen of latest) {
      const box = seen.boundingBox;
      const hit = seen === found;
      context.strokeStyle = hit ? "#38bdf8" : "rgba(255,255,255,0.35)";
      context.lineWidth = hit ? Math.max(3, width / 160) : Math.max(1, width / 480);
      context.strokeRect(box.originX, box.originY, box.width, box.height);
    }
  }

  // -- the screen -------------------------------------------------------------

  function paint() {
    if (!game) return;

    const target = game.target;
    card.textContent = target ? t(`ispy.target.${target.id}`) : "";
    card.hidden = !target;

    fault.textContent = broken ? t(broken) : "";
    fault.hidden = !broken;
    viewfinder.hidden = !!broken || game.seat === null || game.over;
    meter.hidden = !hunting();

    const passed = game.passed.includes(me.sub);
    give.textContent = passed ? t("ispy.gave_up") : t("ispy.give_up");
    give.disabled = passed || game.over || game.seat === null;
    give.hidden = game.over || game.seat === null;

    scores();
    previously();
    scrapbook();
  }

  function scores() {
    table.replaceChildren(
      ...Object.entries(game.counts).map(([sub, count]) => {
        const row = el("li", "ispy-player");
        if (sub === me.sub) row.dataset.me = "true";
        if (game.passed.includes(sub)) row.dataset.passed = "true";

        const name = el("span", "ispy-name");
        name.textContent = sub === me.sub ? t("ui.you") : game.playerNames[sub];

        const score = el("span", "ispy-score");
        score.textContent = count;

        row.append(name, score);
        return row;
      }),
    );
  }

  function previously() {
    // Only while the game is going: once it is over the scrapbook below shows this
    // one too, and showing it twice on the results screen is just clutter.
    const shot = game.over ? null : game.last;
    last.hidden = !shot;
    if (!shot) return;
    last.replaceChildren(...snapshot(shot));
  }

  function scrapbook() {
    gallery.hidden = !game.gallery;
    if (!game.gallery) return;
    gallery.replaceChildren(
      ...game.gallery.map((shot) => {
        const figure = el("figure", "ispy-shot");
        figure.append(...snapshot(shot));
        return figure;
      }),
    );
  }

  // A round that somebody won, with the photograph they won it with -- or one
  // nobody did, which gets a caption and no picture, because there is no picture.
  function snapshot(shot) {
    const caption = el("figcaption", "ispy-caption");
    const what = t(`ispy.target.${shot.target}`);

    if (!shot.winner) {
      caption.textContent = t("ispy.nobody_found", { what });
      return [caption];
    }

    caption.textContent =
      shot.winner === me.sub
        ? t("ispy.you_found", { what })
        : t("ispy.they_found", { name: game.playerNames[shot.winner], what });

    const image = document.createElement("img");
    image.className = "ispy-photo";
    // A jpeg data url, and ispy.py will not relay anything else -- see PHOTO there.
    image.src = shot.photo;
    image.alt = what;

    return [image, caption];
  }

  return {
    update(next) {
      game = next;

      if (round !== game.round) {
        round = game.round;
        hits = 0;
        claimed = 0;
        found = null;
        latest = [];
        bar.style.width = "0%";
      }

      // A seat, a game still going, and no camera yet.
      if (game.seat !== null && !game.over && !eye && !broken && !booting) boot();

      paint();
    },

    destroy() {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      // The camera light stays on until somebody turns it off, and "somebody" is
      // this line. Leaving a game must not leave the lens open.
      eye?.stop();
      eye = null;
    },
  };
}

function el(tag, className) {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function describe(game, me) {
  if (game.status === "waiting") return null;

  const alone = Object.keys(game.counts).length === 1;

  if (game.over) {
    // Against other people the platform already says who won, and says it better
    // than we could. Alone there is nobody to have beaten, so the only thing worth
    // reporting is the score.
    if (!alone) return null;
    return t("ispy.hunt_over", {
      found: game.counts[me.sub] ?? 0,
      rounds: game.rounds,
    });
  }

  const where = t("ispy.round", { round: game.round, rounds: game.rounds });
  if (!game.target) return where;

  return `${where}. ${t("ispy.find", { what: t(`ispy.target.${game.target.id}`) })}`;
}

export function outcome(game, me) {
  if (!game.over) return null;
  if (Object.keys(game.counts).length > 1) return null; // most finds wins; the platform has it

  // Alone, you are playing the deck rather than a person, and Result.by_score hands
  // a lone player the win for turning up. A clean sweep has earned the trumpet.
  // Anything less is a score, and a score wants neither a trumpet nor a sad noise.
  return (game.counts[me.sub] ?? 0) === game.rounds ? "win" : "none";
}
