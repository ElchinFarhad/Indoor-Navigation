import { Cue } from '../../nav/announcer';
import { AudioGuide } from '../guide';
import { effectDuration, effectLead } from '../sounds';
import { scoreVoice } from '../voice';

describe('voice ranking', () => {
  const rank = (names: Array<{ name: string; lang?: string; default?: boolean; localService?: boolean }>) =>
    names
      .map((v) => ({ lang: 'en-US', ...v }))
      .sort((a, b) => scoreVoice(b) - scoreVoice(a))
      .map((v) => v.name);

  it('prefers natural voices over the browser default on a desktop', () => {
    const order = rank([
      { name: 'Microsoft David - English (United States)', default: true },
      { name: 'Microsoft Aria Online (Natural) - English (United States)', localService: false },
      { name: 'Google US English', localService: false },
    ]);
    expect(order[0]).toMatch(/Aria Online \(Natural\)/);
    expect(order[1]).toBe('Google US English');
  });

  it('avoids the novelty and first-generation voices of Apple devices', () => {
    const order = rank([
      { name: 'Albert' },
      { name: 'Fred', default: true },
      { name: 'Zarvox' },
      { name: 'Eddy (English (US))' },
      { name: 'Samantha' },
      { name: 'Ava (Premium)' },
    ]);
    expect(order.slice(0, 2)).toEqual(['Ava (Premium)', 'Samantha']);
    expect(scoreVoice({ name: 'Zarvox', lang: 'en-US' })).toBeLessThan(0);
  });

  it('never picks a voice of another language', () => {
    expect(scoreVoice({ name: 'Google italiano', lang: 'it-IT' })).toBeLessThan(scoreVoice({ name: 'Fred', lang: 'en-US' }));
    expect(scoreVoice({ name: 'Alice', lang: 'it_IT' })).toBe(-100);
    expect(scoreVoice({ name: 'Karen', lang: 'en-AU' })).toBeGreaterThan(0);
  });
});

describe('sound effects', () => {
  it('are short', () => {
    for (const name of ['start', 'turn', 'checkpoint', 'reroute', 'warning', 'floor'] as const) {
      expect(effectDuration(name)).toBeLessThan(1);
      expect(effectLead(name)).toBeLessThan(0.6);
    }
    expect(effectDuration('arrive')).toBeLessThan(2);
    expect(effectDuration('checkpoint')).toBeLessThan(0.25);
  });
});

describe('audio queue', () => {
  let spoken: string[];
  let finishSpeech: () => void;
  let guide: AudioGuide;

  let clock = 0;

  beforeEach(() => {
    jest.useFakeTimers();
    clock = 1000000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    window.localStorage.clear();
    spoken = [];
    finishSpeech = () => undefined;
    let current: any = null;
    (window as any).SpeechSynthesisUtterance = function (this: any, text: string) {
      this.text = text;
    };
    (window as any).speechSynthesis = {
      getVoices: () => [],
      speak: (u: any) => {
        if (u.volume === 0) return;
        current = u;
        spoken.push(u.text);
        finishSpeech = () => {
          const done = current;
          current = null;
          if (done && done.onend) done.onend();
        };
      },
      cancel: () => {
        current = null;
      },
    };
    guide = new AudioGuide();
  });

  afterEach(() => {
    guide.dispose();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (window as any).speechSynthesis;
  });

  const cue = (key: string, priority: number, text?: string, extra: Partial<Cue> = {}): Cue => ({ key, priority, text, ...extra });
  /** Lets timers and promise callbacks run for `ms` of fake time. */
  const pass = async (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      clock += 50;
      jest.advanceTimersByTime(50);
      await Promise.resolve();
      await Promise.resolve();
    }
  };
  const settle = () => pass(50);
  const endSentence = async () => {
    finishSpeech();
    await pass(400);
  };

  it('says one thing at a time and lets a sentence finish before the next of equal priority', async () => {
    guide.push(cue('a', 1, 'First sentence.'));
    guide.push(cue('b', 1, 'Second sentence.'));
    await settle();
    expect(spoken).toEqual(['First sentence.']);
    await endSentence();
    expect(spoken).toEqual(['First sentence.', 'Second sentence.']);
  });

  it('lets something more important interrupt', async () => {
    guide.push(cue('preview', 1, 'In about 10 metres, turn left.'));
    await settle();
    guide.push(cue('wrong', 3, 'Please turn around.'));
    await settle();
    expect(spoken).toEqual(['In about 10 metres, turn left.', 'Please turn around.']);
  });

  it('never plays the same cue twice and drops what has gone stale while waiting', async () => {
    guide.push(cue('a', 1, 'One.'));
    guide.push(cue('a', 1, 'One.'));
    guide.push(cue('late', 1, 'Too late.', { ttl: 1000 }));
    await settle();
    await pass(1500); // the first sentence takes a while
    await endSentence();
    guide.push(cue('a', 1, 'One.'));
    await pass(500);
    expect(spoken).toEqual(['One.']);
  });

  it('skips background ticks while speaking and keeps the queue short', async () => {
    guide.push(cue('a', 1, 'Talking.'));
    await settle();
    guide.push(cue('tick', 0, undefined, { sound: 'checkpoint' }));
    for (let i = 0; i < 6; i++) guide.push(cue(`q${i}`, 1, `Queued ${i}.`));
    for (let i = 0; i < 10; i++) await endSentence();
    expect(guide.played.some((p) => p.key === 'tick')).toBe(false);
    expect(spoken.length).toBe(4); // the one playing + three queued
  });

  it('respects the mode: sounds only, or nothing', async () => {
    guide.setMode('sounds');
    guide.push(cue('a', 2, 'Not spoken.', { sound: 'turn' }));
    await pass(1000);
    expect(spoken).toEqual([]);
    expect(guide.played[0].text).toBeNull();
    guide.setMode('off');
    guide.push(cue('b', 3, 'Nothing.'));
    await pass(1000);
    expect(guide.played.length).toBe(1);
    expect(window.localStorage.getItem('indoor-nav.audio')).toBe('off');
  });
});
