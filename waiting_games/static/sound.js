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

// Down, and down, and down, and then the long droop. Three descending notes each
// sagging a little, and a fourth that gives up entirely -- which is the whole
// character of the thing, and the reason each note is a BEND and not a pitch.
const TROMBONE = [
  { from: 233, to: 220, at: 0.0, span: 0.2 },
  { from: 208, to: 196, at: 0.22, span: 0.2 },
  { from: 185, to: 175, at: 0.44, span: 0.2 },
  { from: 175, to: 98, at: 0.66, span: 0.85 },
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

export function trombone() {
  const ctx = audio();

  // A sawtooth is all harmonics and sounds like a buzzer. Rolling the top off it
  // is what turns it into something brassy enough to be recognisably a trombone.
  const brass = ctx.createBiquadFilter();
  brass.type = "lowpass";
  brass.frequency.value = 900;
  brass.connect(ctx.destination);

  for (const shape of TROMBONE) note(brass, { ...shape, type: "sawtooth" });
}

export function shrug() {
  const ctx = audio();
  for (const shape of SHRUG) note(ctx.destination, { ...shape, type: "sine" });
}
