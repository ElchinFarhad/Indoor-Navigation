/**
 * Plays the cues of the announcer: decides what is heard when several things
 * want to be heard at once.
 *
 *  - One thing at a time. A sound effect introduces its sentence; the sentence
 *    starts when the effect's body is over.
 *  - A sentence is never cut off by something of the same or lower priority;
 *    those wait their turn. Only something more important interrupts.
 *  - What waits too long is dropped (a turn prompt is useless ten seconds
 *    late), the queue is short, and the same cue is never queued twice.
 *  - Background ticks (passing a marker) are skipped while anything else is
 *    playing, and effects are rate limited, so it never turns into beeping.
 */
import { Cue } from '../nav/announcer';
import { measureEffect, SoundEngine } from './sounds';
import { VoiceEngine } from './voice';

export type AudioMode = 'voice' | 'sounds' | 'off';

export interface PlayedCue {
  key: string;
  sound: string | null;
  text: string | null;
  at: number;
}

const MODE_KEY = 'indoor-nav.audio';
const MAX_QUEUE = 3;
const GAP_MS = 280; // breathing space between two prompts
const MIN_EFFECT_INTERVAL_MS = 900;
const MIN_TICK_INTERVAL_MS = 8000; // the marker tick is a reassurance, not a metronome

export function storedAudioMode(): AudioMode {
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    if (v === 'voice' || v === 'sounds' || v === 'off') return v;
  } catch (e) {
    /* private mode */
  }
  return 'voice';
}

interface Queued {
  cue: Cue;
  at: number;
}

export class AudioGuide {
  readonly sounds = new SoundEngine();
  readonly voice = new VoiceEngine();
  /** What has been played, most recent last (for the tests and for debugging). */
  readonly played: PlayedCue[] = [];

  private currentMode: AudioMode = storedAudioMode();
  private queue: Queued[] = [];
  private playing: Cue | null = null;
  private generation = 0;
  private lastEffectAt = -Infinity;
  private lastTickAt = -Infinity;
  private recent: string[] = [];
  private timer: number | null = null;

  constructor() {
    (window as any).__indoorNavAudio = this.played;
    (window as any).__indoorNavMeasure = measureEffect;
  }

  get mode(): AudioMode {
    return this.currentMode;
  }

  setMode(mode: AudioMode) {
    this.currentMode = mode;
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch (e) {
      /* private mode */
    }
    if (mode !== 'voice') this.voice.cancel();
    if (mode === 'off') this.queue = [];
  }

  /** Call from a tap handler: browsers only allow audio after a user gesture. */
  unlock() {
    this.sounds.unlock();
    this.voice.unlock();
  }

  /** Queues a cue (or plays it at once, or drops it), according to the rules above. */
  push(cue: Cue) {
    if (this.currentMode === 'off') return;
    if (this.recent.indexOf(cue.key) >= 0) return;
    if (this.playing && this.playing.key === cue.key) return;
    if (this.queue.some((q) => q.cue.key === cue.key)) return;

    const busy = this.playing !== null;
    if (busy && cue.priority === 0 && !cue.text) return; // a tick is not worth queueing
    if (busy && cue.priority > this.playing!.priority) {
      // More important than what is being said: take over.
      this.queue.unshift({ cue, at: Date.now() });
      this.interrupt();
      return;
    }
    this.queue.push({ cue, at: Date.now() });
    this.queue.sort((a, b) => b.cue.priority - a.cue.priority || a.at - b.at);
    if (this.queue.length > MAX_QUEUE) this.queue.length = MAX_QUEUE;
    if (!busy) this.next();
  }

  /** Says a sentence right away (used by "test voice"). */
  preview(text: string) {
    this.unlock();
    this.queue = [];
    this.interrupt();
    this.sounds.play('turn');
    this.generation++;
    const generation = this.generation;
    window.setTimeout(() => {
      if (generation === this.generation) this.voice.speak(text);
    }, 350);
  }

  stop() {
    this.queue = [];
    this.interrupt();
  }

  dispose() {
    this.stop();
    this.sounds.close();
  }

  private interrupt() {
    this.generation++;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.playing = null;
    this.voice.cancel();
    if (this.queue.length > 0) this.next();
  }

  private remember(cue: Cue) {
    this.recent.push(cue.key);
    if (this.recent.length > 40) this.recent.shift();
  }

  private next() {
    if (this.playing) return;
    const now = Date.now();
    let item = this.queue.shift();
    while (item && item.cue.ttl !== undefined && now - item.at > item.cue.ttl) item = this.queue.shift();
    if (!item) return;
    const cue = item.cue;
    this.playing = cue;
    this.remember(cue);
    const generation = ++this.generation;

    const speak = this.currentMode === 'voice' && !!cue.text && this.voice.supported;
    let lead = 0;
    let effect: string | null = null;
    const tooSoon =
      cue.priority < 2 &&
      (now - this.lastEffectAt < MIN_EFFECT_INTERVAL_MS || (cue.sound === 'checkpoint' && now - this.lastTickAt < MIN_TICK_INTERVAL_MS));
    if (cue.sound && !tooSoon) {
      lead = this.sounds.play(cue.sound, cue.pan || 0);
      this.lastEffectAt = now;
      if (cue.sound === 'checkpoint') this.lastTickAt = now;
      effect = cue.sound;
    }
    (window as any).__indoorNavAudio = this.played;
    this.played.push({ key: cue.key, sound: effect, text: speak ? cue.text! : null, at: now });
    if (this.played.length > 60) this.played.shift();

    const finished = () => {
      if (generation !== this.generation) return;
      this.timer = window.setTimeout(() => {
        if (generation !== this.generation) return;
        this.timer = null;
        this.playing = null;
        this.next();
      }, GAP_MS);
    };

    if (!speak) {
      this.timer = window.setTimeout(finished, Math.max(120, lead * 1000));
      return;
    }
    this.timer = window.setTimeout(() => {
      if (generation !== this.generation) return;
      this.timer = null;
      this.voice.speak(cue.text!).then(finished);
    }, lead * 1000);
  }
}
