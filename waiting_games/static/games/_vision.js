// The eye: a camera, a detector, and the colour of a box.
//
// ispy.js is the game. This is the machinery it looks through, kept separate
// because none of it is about I Spy -- it is about getting a phone to say "there
// is a dog, and it is over there", which is a different problem with a different
// set of ways to go wrong.
//
// The detector is MediaPipe's ObjectDetector running EfficientDet-Lite0: eighty
// nouns, no adjectives, about 10 frames a second on a mid-range phone. It is 14MB
// of wasm and weights, it is not in git, and it is not on a CDN -- it is fetched
// into the image at build time by scripts/fetch-detector.sh, which pins every byte
// of it. If it is missing, you are running from a checkout and have not run that
// script; the game says so rather than hanging.

const VENDOR = "/static/vendor";
const BUNDLE = `${VENDOR}/mediapipe/vision_bundle.mjs`;
const WASM = `${VENDOR}/mediapipe/wasm`;
const MODEL = `${VENDOR}/models/efficientdet_lite0.tflite`;

// Below this the detector is guessing, and a guess that scores a point is worse
// than a miss.
export const CONFIDENT = 0.45;

// -- the detector -------------------------------------------------------------

// One per tab, built once and never closed.
//
// Closing it on destroy() and rebuilding it on the next game would be tidier and
// would cost a second of black screen every rematch, for memory a browser reclaims
// the moment the tab goes away. Tidiness loses.
let detecting = null;

export function detector() {
  if (!detecting) {
    detecting = build().catch((error) => {
      // Do NOT keep a rejected promise here. Caching the failure would mean one bad
      // load -- a flaky first fetch of the 7MB model -- is permanent for the life of
      // the tab, and every rematch would fail instantly and identically without ever
      // trying again.
      detecting = null;
      throw error;
    });
  }
  return detecting;
}

async function build() {
  const { FilesetResolver, ObjectDetector } = await import(BUNDLE);
  const vision = await FilesetResolver.forVisionTasks(WASM);

  // The model is the FLOAT16 build, and the download is 7.2MB rather than 4.4MB
  // because of it. That is not a rounding error and it is not a choice -- the int8
  // build of the same model does not work on the GPU delegate, which is the delegate
  // every phone gets.
  //
  // It does not fail, either. Pointed at a photograph of a dog, a bicycle and a
  // truck, int8-on-GPU returned "dining table, 0.17" and then nothing; float16, same
  // frame, same threshold, found all three at 0.65. No exception, so the catch below
  // never fires and the fallback never happens: the game just quietly never finds
  // anything, on every device anybody owns. Measured, not guessed.
  //
  // So if you are here to shrink the download, the model is not where the 3MB is.
  const options = {
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    scoreThreshold: CONFIDENT,
    maxResults: 12,
  };

  try {
    return await ObjectDetector.createFromOptions(vision, options);
  } catch {
    // No usable GPU at all -- an old phone, a locked-down browser, a desktop with
    // WebGL switched off. THIS is what the fallback is for, and it is the only thing
    // it is for: a missing GPU throws, where a bad model quietly lies. The cpu path
    // is slower and completely playable, which beats a black screen.
    options.baseOptions.delegate = "CPU";
    return ObjectDetector.createFromOptions(vision, options);
  }
}

// -- the camera ---------------------------------------------------------------

export async function camera() {
  // getUserMedia does not exist outside a secure context, so over plain http on a
  // LAN address -- http://some-box:8080, exactly how you would show this to the
  // room -- `navigator.mediaDevices` is undefined rather than merely refusing.
  // Reading .getUserMedia off it would throw a TypeError, which is not a sentence
  // anybody can act on. This is.
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("insecure");

  const stream = await navigator.mediaDevices.getUserMedia({
    // `ideal`, not `exact`: a laptop has no environment camera and exact would
    // fail outright rather than handing over the one camera it does have.
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
    audio: false,
  });

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  // Without this, ios plays the stream FULLSCREEN, over the top of the game.
  video.playsInline = true;
  video.srcObject = stream;

  await video.play();
  return { video, stop: () => stream.getTracks().forEach((track) => track.stop()) };
}

// -- what colour is that? -----------------------------------------------------
//
// The detector knows eighty nouns and not one adjective, so "a red car" is not
// something it can be asked. But it hands back a BOX, and the colour of the pixels
// inside a box is arithmetic. This is the whole trick, and it is why the deck can
// ask for a colour at all.

// The middle of the box, not the box. A bounding box is a rectangle around
// something that is not a rectangle, so its corners are whatever was BEHIND the
// car -- and on a thin thing, the corners outvote the car. Standing well inside it
// costs a little of the paintwork and buys a lot of not-the-sky.
const INSET = 0.2;

// A 24x24 crop is 576 pixels, which is a big enough sample to be stable and a
// small enough readback to do ten times a second without the phone getting hot.
const GRID = 24;

// Everything below is min, max, subtract and divide. No sqrt, no trig -- not for
// determinism (nothing replays this; the server never sees the pixels) but because
// there is no reason to reach for them, and hue does not need them.
const swatch = document.createElement("canvas");
swatch.width = GRID;
swatch.height = GRID;
const swatchCtx = swatch.getContext("2d", { willReadFrequently: true });

export function colourIn(video, box) {
  const sx = box.originX + box.width * INSET;
  const sy = box.originY + box.height * INSET;
  const sw = box.width * (1 - 2 * INSET);
  const sh = box.height * (1 - 2 * INSET);
  if (sw < 1 || sh < 1) return null;

  swatchCtx.drawImage(video, sx, sy, sw, sh, 0, 0, GRID, GRID);
  const { data } = swatchCtx.getImageData(0, 0, GRID, GRID);

  const tally = new Map();
  const total = data.length / 4;
  for (let index = 0; index < data.length; index += 4) {
    const name = nameOf(data[index], data[index + 1], data[index + 2]);
    if (name) tally.set(name, (tally.get(name) ?? 0) + 1);
  }

  let best = null;
  let count = 0;
  for (const [name, seen] of tally) {
    if (seen > count) [best, count] = [name, seen];
  }

  // A share of EVERY pixel looked at, including the grey ones that named nothing.
  // That is the point: a grey car with a red stripe is a grey car, and it should
  // come back null rather than "red" on the strength of the stripe being the only
  // thing with an opinion.
  return count / total >= 0.3 ? best : null;
}

function nameOf(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;

  const value = max / 255;
  const saturation = max === 0 ? 0 : chroma / max;

  if (saturation < 0.25) {
    if (value > 0.72) return "white";
    if (value < 0.28) return "black";
    // Grey. It names nothing, on purpose -- half the built world is grey, and a
    // colour that matches half the world is not a colour worth asking for. It
    // still counts against the share above.
    return null;
  }

  let hue;
  if (max === r) hue = 60 * (((g - b) / chroma) % 6);
  else if (max === g) hue = 60 * ((b - r) / chroma + 2);
  else hue = 60 * ((r - g) / chroma + 4);
  if (hue < 0) hue += 360;

  if (hue < 20 || hue >= 340) return "red";
  if (hue < 45) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 160) return "green";
  if (hue < 250) return "blue";
  if (hue < 290) return "purple";
  return "pink";
}

// -- the photograph -----------------------------------------------------------

// Wide enough to see what was found, small enough to put on a WebSocket that every
// other player is listening to. 480px of jpeg at 0.6 runs 30-50kB; ispy.py will not
// take more than 96kB of base64, and this stays comfortably under it.
const PHOTO_WIDTH = 480;
const PHOTO_QUALITY = 0.6;

export function capture(video) {
  const width = Math.min(PHOTO_WIDTH, video.videoWidth);
  const scale = width / video.videoWidth;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);

  // jpeg, not png: a png of a photograph is enormous, and ispy.py accepts nothing
  // else -- a jpeg cannot carry a script, and an svg can.
  return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
}
