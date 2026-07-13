// Winning and losing, out loud.
//
// Synthesised, not sampled. A fanfare and a sad trombone as audio files would be
// a few hundred kilobytes of binary sitting in a repo that is otherwise entirely
// text -- and they would have to be fetched, cached and versioned, for two
// sounds that a handful of oscillators produce here for nothing.
//
// The mute is remembered. Sound a player cannot turn off is sound they turn off
// by closing the tab.

const STORAGE_KEY = "wg_sound";

// Loud enough to be a joke, quiet enough not to be a jump-scare on headphones.
const VOLUME = 0.22;

let context = null;
let enabled = localStorage.getItem(STORAGE_KEY) !== "off";

export function soundOn() {
  return enabled;
}

export function setSound(next) {
  enabled = next;
  localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
}

// An AudioContext built before the player has interacted with the page starts
// SUSPENDED, and stays that way until a gesture resumes it. By the time anything
// here can fire, a player has clicked at least a start or a join -- but a
// spectator who followed a link and never clicked anything has not. So resume,
// rather than assume, and let it stay silent for them if the browser insists.
function audio() {
  if (!context) context = new AudioContext();
  if (context.state === "suspended") context.resume();
  return context;
}

// One note, with a pitch bend. `to` equal to `from` is a flat note.
//
// The ramps are exponential because loudness and pitch are both perceived that
// way -- a linear fade sounds like it stops abruptly -- and they target 0.0001
// rather than 0 because an exponential ramp to zero is undefined and silently
// does nothing at all.
function note(destination, { from, to = from, at, span, type = "triangle" }) {
  const ctx = context;
  const start = ctx.currentTime + at;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  if (to !== from) {
    osc.frequency.exponentialRampToValueAtTime(to, start + span);
  }

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(VOLUME, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + span);

  osc.connect(gain).connect(destination);
  osc.start(start);
  osc.stop(start + span + 0.05);
}

// Up, and up, and up. A major arpeggio landing on the octave.
const FANFARE = [
  { from: 523, at: 0.0, span: 0.13 },
  { from: 659, at: 0.11, span: 0.13 },
  { from: 784, at: 0.22, span: 0.13 },
  { from: 1047, at: 0.33, span: 0.42 },
];

// Wah, wah, wah, waaaah. Three notes descending, each sagging as it goes, and a
// fourth that gives up entirely -- which is the whole character of the thing, and
// the reason every note is a BEND rather than a pitch.
//
// Slower than it looks like it should be. The first version ran the four notes in
// two thirds of a second and read as a buzzer going off; the joke needs the time
// it takes to be a shrug.
const TROMBONE = [
  { from: 233, to: 220, at: 0.0, span: 0.34 },
  { from: 208, to: 196, at: 0.36, span: 0.34 },
  { from: 185, to: 175, at: 0.72, span: 0.34 },
  // The one that dies: an octave and a half down, wobbling harder the further it
  // falls, and taking its time about it.
  { from: 175, to: 65, at: 1.08, span: 1.3, wobble: 9 },
];

// Neither. Two flat notes, going nowhere.
const SHRUG = [
  { from: 440, at: 0.0, span: 0.16 },
  { from: 415, at: 0.16, span: 0.3 },
];

export function fanfare() {
  const ctx = audio();
  for (const shape of FANFARE) note(ctx.destination, shape);
}

// One brass note.
//
// A sawtooth through a fixed lowpass -- what this used to be -- is a muffled
// buzzer. Three things turn it into a trombone, and all three are per-note:
//
//   the filter SWEEPS. A resonant lowpass falling from bright to dark over the
//   note is the "wah". A static one cannot make that shape, and the shape is
//   most of what the ear is listening for.
//
//   the note is TWO sawtooths, a few cents apart. One alone is thin and synthetic;
//   the slow beating between two detuned copies is what gives it a body.
//
//   the note is HELD, not faded. Brass sits on its volume and then stops. The old
//   envelope ramped down across the whole span, which is a decaying pluck.
function brass(destination, { from, to = from, at, span, wobble = 0 }) {
  const ctx = context;
  const start = ctx.currentTime + at;
  const end = start + span;

  const wah = ctx.createBiquadFilter();
  wah.type = "lowpass";
  wah.Q.value = 5; // resonant enough that the sweep is heard as a vowel
  wah.frequency.setValueAtTime(from * 6, start);
  wah.frequency.exponentialRampToValueAtTime(from * 1.5, end);

  const gain = ctx.createGain();
  // Half of VOLUME: two oscillators sum into this, and the filter's resonance
  // adds a little more on top.
  const level = VOLUME * 0.5;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, start + 0.05); // a lipped attack
  gain.gain.setValueAtTime(level, end - span * 0.3); // ...then held, not fading
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  wah.connect(gain).connect(destination);

  // The wobble creeps IN as the note sags -- it is a player running out of breath,
  // not a vibrato they meant. It rides on top of the pitch bend: an AudioParam
  // sums whatever is connected to it with its own automation, so the two do not
  // fight over frequency.
  let depth = null;
  if (wobble) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;

    depth = ctx.createGain();
    depth.gain.setValueAtTime(0.0001, start);
    depth.gain.exponentialRampToValueAtTime(wobble, end);

    lfo.connect(depth);
    lfo.start(start);
    lfo.stop(end + 0.05);
  }

  for (const detune of [-7, 7]) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(from, start);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, end);
    if (depth) depth.connect(osc.frequency);
    osc.connect(wah);
    osc.start(start);
    osc.stop(end + 0.05);
  }
}

export function trombone() {
  const ctx = audio();
  for (const shape of TROMBONE) brass(ctx.destination, shape);
}

export function shrug() {
  const ctx = audio();
  for (const shape of SHRUG) note(ctx.destination, { ...shape, type: "sine" });
}
