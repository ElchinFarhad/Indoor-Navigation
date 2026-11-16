/**
 * Spoken guidance through the browser's speech synthesis.
 *
 * A web page cannot ship its own human voice without a server, so the quality
 * of the speech is the quality of the voices installed on the device - and
 * those differ enormously. Phones and desktops usually come with both modern,
 * natural-sounding voices and old robotic ones, and the browser's *default* is
 * often not the best. This module ranks the available voices (neural / natural
 * / enhanced ones first, known novelty and legacy voices last), picks the best
 * one, and lets the user choose another.
 */
import { currentLang } from '../i18n';

export interface VoiceInfo {
  uri: string;
  name: string;
  lang: string;
  score: number;
}

interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
  default?: boolean;
  voiceURI?: string;
}

const NATURAL = /natural|neural|wavenet|online \(natural\)/i;
const ENHANCED = /premium|enhanced|siri|studio/i;
const GOOD_GOOGLE = /^google (us|uk) english/i;
// Pleasant standard voices on Apple and Windows systems.
const GOOD_NAMES = /\b(samantha|ava|allison|susan|zoe|evan|nathan|joelle|noelle|karen|serena|daniel|moira|tessa|aria|jenny|guy|sonia|libby|ryan|michelle|zira|hazel)\b/i;
// Novelty and first-generation voices that sound mechanical.
const ROBOTIC = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|princess|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|espeak|eloquence|pico|festival|mbrola)\b/i;

/**
 * How suitable a voice is for navigation prompts in `language` (higher is better).
 * Voices of another language score below zero.
 */
export function scoreVoice(voice: VoiceLike, language = 'en-US'): number {
  const lang = (voice.lang || '').replace('_', '-').toLowerCase();
  const wanted = language.toLowerCase();
  if (lang.slice(0, 2) !== wanted.slice(0, 2)) return -100;
  let score = lang === wanted ? 12 : lang === 'en-us' || lang === 'en-gb' ? 8 : 4;
  if (NATURAL.test(voice.name)) score += 60;
  if (ENHANCED.test(voice.name)) score += 45;
  if (GOOD_GOOGLE.test(voice.name)) score += 32;
  if (GOOD_NAMES.test(voice.name)) score += 20;
  if (ROBOTIC.test(voice.name)) score -= 70;
  if (voice.localService === false) score += 4; // network voices tend to be the newer ones
  if (voice.default) score += 3;
  return score;
}

const STORAGE_KEY = 'indoor-nav.voice';

function stored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return null;
  }
}

export class VoiceEngine {
  /** Speaking rate; slightly under 1 is easier to follow while walking. */
  rate = 0.97;
  private synth: SpeechSynthesis | null;
  private current: SpeechSynthesisUtterance | null = null;
  private chosen: string | null = stored();
  private finish: (() => void) | null = null;

  constructor() {
    this.synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
    // Voices load asynchronously in most browsers: touching the list starts that.
    if (this.synth) {
      try {
        this.synth.getVoices();
      } catch (e) {
        /* ignore */
      }
    }
  }

  get supported(): boolean {
    return this.synth !== null && typeof (window as any).SpeechSynthesisUtterance === 'function';
  }

  get speaking(): boolean {
    return this.current !== null;
  }

  private rawVoices(): SpeechSynthesisVoice[] {
    try {
      return this.synth ? this.synth.getVoices() : [];
    } catch (e) {
      return [];
    }
  }

  /** Voices that can read the prompts, best first. */
  voices(): VoiceInfo[] {
    // The prompts are in the app's language; within it, prefer the phone's own regional variant.
    const app = currentLang();
    const own = typeof navigator !== 'undefined' && navigator.language && navigator.language.slice(0, 2) === app ? navigator.language : null;
    const language = own || (app === 'it' ? 'it-IT' : 'en-US');
    return this.rawVoices()
      .map((v) => ({ uri: v.voiceURI, name: v.name, lang: v.lang, score: scoreVoice(v, language) }))
      .filter((v) => v.score > -100)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  /** The voice in use: the user's choice if it still exists, otherwise the best one. */
  selected(): VoiceInfo | null {
    const list = this.voices();
    return list.find((v) => v.uri === this.chosen) || list[0] || null;
  }

  select(uri: string | null) {
    this.chosen = uri;
    try {
      if (uri) window.localStorage.setItem(STORAGE_KEY, uri);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* private mode */
    }
  }

  /** iOS only speaks after a first utterance made inside a tap handler. */
  unlock() {
    if (!this.supported || !this.synth) return;
    try {
      const silent = new SpeechSynthesisUtterance(' ');
      silent.volume = 0;
      this.synth.speak(silent);
    } catch (e) {
      /* ignore */
    }
  }

  /** Speaks a sentence. Resolves when it has been said (or cut off, or could not be said). */
  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.supported || !this.synth) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      const choice = this.selected();
      const voice = choice ? this.rawVoices().find((v) => v.voiceURI === choice.uri) : undefined;
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = currentLang() === 'it' ? 'it-IT' : 'en-US';
      }
      utterance.rate = this.rate;
      utterance.pitch = 1;
      utterance.volume = 1;

      let done = false;
      // Some browsers occasionally never report the end of an utterance.
      const watchdog = window.setTimeout(() => end(), 2500 + text.length * 110);
      const end = () => {
        if (done) return;
        done = true;
        window.clearTimeout(watchdog);
        if (this.current === utterance) {
          this.current = null;
          this.finish = null;
        }
        resolve();
      };
      utterance.onend = end;
      utterance.onerror = end;
      this.current = utterance; // also keeps it from being garbage collected mid-sentence
      this.finish = end;
      try {
        this.synth.speak(utterance);
      } catch (e) {
        end();
      }
    });
  }

  /** Stops talking immediately. */
  cancel() {
    if (!this.synth) return;
    try {
      this.synth.cancel();
    } catch (e) {
      /* ignore */
    }
    if (this.finish) this.finish();
  }
}
