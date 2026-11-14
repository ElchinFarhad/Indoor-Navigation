/**
 * Sound effects, synthesised with the Web Audio API (no audio files).
 *
 * Every effect is a few soft, bell-like notes: a sine fundamental with two
 * quiet overtones, a quick but not clicking attack and a natural exponential
 * decay, through a gentle low-pass and a touch of echo. Pitches come from one
 * pentatonic set so the effects sound related, and each event has its own
 * contour: rising for "go", falling for "changed", a low pulse for a warning,
 * a small arpeggio for arriving.
 */
import { SoundName } from '../nav/announcer';

interface Note {
  /** Frequency in Hz. */
  f: number;
  /** Start, seconds after the beginning of the effect. */
  at: number;
  /** Time for the note to die away, seconds. */
  decay: number;
  /** Peak level, 0..1 (before the master volume). */
  level: number;
  /** Softer, rounder tone (fewer overtones) for low or background notes. */
  soft?: boolean;
}

// D major pentatonic.
const D4 = 293.66, A4 = 440, B4 = 493.88, D5 = 587.33, E5 = 659.25, FS5 = 739.99, A5 = 880, D6 = 1174.66;

const EFFECTS: { [name in SoundName]: Note[] } = {
  // Two notes up: "here we go".
  start: [
    { f: A4, at: 0, decay: 0.5, level: 0.5 },
    { f: E5, at: 0.13, decay: 0.75, level: 0.55 },
  ],
  // One clear note with its octave: "now".
  turn: [
    { f: FS5, at: 0, decay: 0.42, level: 0.55 },
    { f: A5, at: 0.09, decay: 0.55, level: 0.4 },
  ],
  // A barely-there tick when a marker is passed.
  checkpoint: [{ f: D6, at: 0, decay: 0.16, level: 0.2, soft: true }],
  // Two notes down: "changed plan".
  reroute: [
    { f: E5, at: 0, decay: 0.4, level: 0.45 },
    { f: B4, at: 0.14, decay: 0.6, level: 0.45 },
  ],
  // Two low, round pulses: noticeable without being an alarm.
  warning: [
    { f: D4, at: 0, decay: 0.3, level: 0.6, soft: true },
    { f: D4, at: 0.24, decay: 0.42, level: 0.6, soft: true },
  ],
  // Three quick steps.
  floor: [
    { f: A4, at: 0, decay: 0.3, level: 0.4 },
    { f: D5, at: 0.1, decay: 0.3, level: 0.4 },
    { f: FS5, at: 0.2, decay: 0.6, level: 0.45 },
  ],
  // A small rising arpeggio that rings out.
  arrive: [
    { f: D5, at: 0, decay: 0.7, level: 0.45 },
    { f: FS5, at: 0.12, decay: 0.8, level: 0.45 },
    { f: A5, at: 0.24, decay: 0.95, level: 0.45 },
    { f: D6, at: 0.4, decay: 1.4, level: 0.5 },
  ],
};

/** Length of an effect in seconds (until its last note has faded). */
export function effectDuration(name: SoundName): number {
  return EFFECTS[name].reduce((d, n) => Math.max(d, n.at + n.decay), 0);
}

/** Time until the body of the effect is over and speech can start, seconds. */
export function effectLead(name: SoundName): number {
  const notes = EFFECTS[name];
  return notes[notes.length - 1].at + 0.28;
}

/**
 * Schedules an effect on any audio context (a live one, or an offline one for tests).
 * @param pan stereo position, -1 (left) to 1 (right)
 */
export function scheduleEffect(ctx: BaseAudioContext, destination: AudioNode, name: SoundName, when: number, pan = 0) {
  const out = ctx.createGain();
  out.gain.value = 1;

  // A little air: one quiet echo.
  const echo = ctx.createDelay(0.5);
  echo.delayTime.value = 0.12;
  const echoLevel = ctx.createGain();
  echoLevel.gain.value = 0.16;
  out.connect(echo);
  echo.connect(echoLevel);

  let tail: AudioNode = out;
  let tailEcho: AudioNode = echoLevel;
  const anyCtx = ctx as any;
  if (pan !== 0 && typeof anyCtx.createStereoPanner === 'function') {
    const panner = anyCtx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner);
    echoLevel.connect(panner);
    tail = panner;
    tailEcho = panner;
  }
  tail.connect(destination);
  if (tailEcho !== tail) tailEcho.connect(destination);

  for (const note of EFFECTS[name]) {
    const start = when + note.at;
    const end = start + note.decay;
    const envelope = ctx.createGain();
    // 12 ms attack: fast enough to feel immediate, slow enough not to click.
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(note.level, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = note.soft ? 1400 : 4200;
    tone.Q.value = 0.5;
    envelope.connect(tone);
    tone.connect(out);

    const partials = note.soft ? [[1, 1]] : [[1, 1], [2, 0.22], [3, 0.07]];
    for (const [multiple, level] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = note.f * multiple;
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain);
      gain.connect(envelope);
      osc.start(start);
      osc.stop(end + 0.05);
    }
  }
}

/**
 * Renders an effect offline and measures it. Used by the end-to-end test to
 * check that every effect is audible, does not clip and is as short as intended.
 */
export function measureEffect(name: SoundName): Promise<{ peak: number; rms: number; seconds: number } | null> {
  const w = window as any;
  const Offline = w.OfflineAudioContext || w.webkitOfflineAudioContext;
  if (!Offline) return Promise.resolve(null);
  const rate = 44100;
  const ctx = new Offline(2, Math.ceil(rate * (effectDuration(name) + 0.6)), rate);
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  scheduleEffect(ctx, master, name, 0.02, 0);
  return ctx.startRendering().then((buffer: AudioBuffer) => {
    const data = buffer.getChannelData(0);
    let peak = 0;
    let sum = 0;
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
      sum += v * v;
      if (v > 0.003) last = i;
    }
    return { peak, rms: Math.sqrt(sum / data.length), seconds: last / rate };
  });
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 0..1 */
  volume = 0.5;

  get supported(): boolean {
    const w = window as any;
    return typeof w.AudioContext === 'function' || typeof w.webkitAudioContext === 'function';
  }

  /**
   * Creates / resumes the audio context. Browsers only allow sound after a
   * user gesture, so call this from a tap handler.
   */
  unlock() {
    if (!this.supported) return;
    try {
      if (!this.ctx) {
        const w = window as any;
        const Ctor = w.AudioContext || w.webkitAudioContext;
        const ctx: AudioContext = new Ctor();
        this.ctx = ctx;
        const master = ctx.createGain();
        this.master = master;
        master.gain.value = this.volume;
        // A soft limiter so stacked notes never clip.
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -14;
        limiter.ratio.value = 6;
        master.connect(limiter);
        limiter.connect(ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {
      this.ctx = null;
    }
  }

  /** Plays an effect now. Returns how long to wait before speaking over it, in seconds (0 if nothing played). */
  play(name: SoundName, pan = 0): number {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return 0;
    try {
      this.master.gain.value = this.volume;
      scheduleEffect(ctx, this.master, name, ctx.currentTime + 0.02, pan);
      return effectLead(name);
    } catch (e) {
      return 0;
    }
  }

  close() {
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch (e) {
        /* already closed */
      }
    }
    this.ctx = null;
    this.master = null;
  }
}
