/**
 * Decides what the app says and which sound it plays, and when.
 *
 * It watches the navigation session and turns its state into "cues" - short,
 * conversational sentences and named sound effects - the way a person giving
 * directions would: an early heads-up before a turn, a short prompt at the
 * turn, a word when the route changes, and otherwise silence. Each thing is
 * said once. Playing the cues (voice, sound, queueing) is the job of
 * audio/guide.ts; this module has no audio code and is plain logic.
 */
import { Building, NavNode } from './building';
import { Guidance, Maneuver, ManeuverType } from './instructions';
import { NavEvent, NavSnapshot } from './navigator';

export type SoundName = 'start' | 'turn' | 'checkpoint' | 'reroute' | 'warning' | 'floor' | 'arrive';

export interface Cue {
  /** Identifies the cue, so the same thing is never queued twice. */
  key: string;
  sound?: SoundName;
  /** Stereo position of the sound, -1 (left) to 1 (right): turns come from their side. */
  pan?: number;
  /** Sentence to speak. */
  text?: string;
  /** 0 = nice to have, 1 = guidance, 2 = important, 3 = must be heard now. */
  priority: number;
  /** A cue that waited longer than this (milliseconds) is no longer worth playing. */
  ttl?: number;
}

const PREVIEW_FROM = 16; // metres before a maneuver at which it is first announced
const PREVIEW_MIN = 6; // closer than this the "now" prompt is about to follow anyway
const NOW_AT = 3.5; // metres before a maneuver at which the prompt is given
const REASSURE_FROM = 20; // a straight at least this long gets a "continue straight"

/** "about 10 metres": rounded the way people say distances. */
export function spokenDistance(meters: number): string {
  let n: number;
  if (meters < 8) n = Math.max(2, Math.round(meters));
  else if (meters < 30) n = Math.round(meters / 5) * 5;
  else n = Math.round(meters / 10) * 10;
  return `about ${n} metres`;
}

/** Room codes are read as people say them: "0.21" becomes "0 21" (zero twenty-one). */
export function spokenName(text: string): string {
  return text.replace(/(\d)\.(\d\d)\b/g, '$1 $2').replace(/\bWC\b/g, 'restrooms');
}

const ACTION: { [k: string]: string } = {
  'slight-left': 'keep left',
  left: 'turn left',
  'sharp-left': 'take a sharp left',
  'slight-right': 'keep right',
  right: 'turn right',
  'sharp-right': 'take a sharp right',
  uturn: 'turn around',
  straight: 'continue straight',
};

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sideOf(type: ManeuverType): number {
  if (type.indexOf('left') >= 0) return -0.55;
  if (type.indexOf('right') >= 0) return 0.55;
  return 0;
}

export class Announcer {
  private building: Building;
  private said = new Set<string>();
  private lastManeuverKey: string | null = null;
  private wasUncertain = false;
  private started = false;

  constructor(building: Building) {
    this.building = building;
  }

  /** What to do for a maneuver, as a phrase without capital or full stop. */
  private action(m: Maneuver): string {
    if (m.type.indexOf('stairs') === 0 || m.type.indexOf('elevator') === 0) {
      const floor = m.toFloor !== undefined ? this.building.floor(m.toFloor) : undefined;
      const way = m.type.indexOf('stairs') === 0 ? 'take the stairs' : 'take the lift';
      const direction = m.type.slice(-2) === 'up' ? 'up' : 'down';
      return `${way} ${direction}${floor ? ` to ${floor.spoken}` : ''}`;
    }
    return ACTION[m.type] || 'continue';
  }

  /** ", at the lobby" - where the maneuver happens, if that is worth saying. */
  private where(m: Maneuver): string {
    if (m.type.indexOf('stairs') === 0 || m.type.indexOf('elevator') === 0 || m.type === 'uturn') return '';
    const node = m.nodeId !== null && m.nodeId !== undefined ? this.building.node(m.nodeId) : undefined;
    if (!node || !node.label || !m.detail) return '';
    return `, ${spokenName(m.detail)}`;
  }

  private destinationName(snapshot: NavSnapshot): string {
    return spokenName(this.building.displayName(snapshot.destination));
  }

  private sidePhrase(snapshot: NavSnapshot): string {
    if (snapshot.destinationSide === 'left') return ', on your left';
    if (snapshot.destinationSide === 'right') return ', on your right';
    if (snapshot.destinationSide === 'ahead') return ', straight ahead';
    return '';
  }

  private key(m: Maneuver): string {
    return `${m.type}:${m.nodeId === undefined ? 'x' : m.nodeId}`;
  }

  /** The sentence for the current guidance, as said when a route starts or changes. */
  private instruction(g: Guidance, snapshot: NavSnapshot): string {
    const m = g.maneuver;
    if (m.type === 'arrive') {
      if (g.distance < 3) return `It's right here${this.sidePhrase(snapshot)}.`;
      return `It's ${spokenDistance(g.distance)} ahead${this.sidePhrase(snapshot)}.`;
    }
    if (g.distance <= NOW_AT) return `${capital(this.action(m))}${this.where(m)}.`;
    return `In ${spokenDistance(g.distance)}, ${this.action(m)}${this.where(m)}.`;
  }

  /** Remembers that the current guidance has just been spoken as part of another sentence. */
  private markSpoken(g: Guidance) {
    const k = this.key(g.maneuver);
    this.said.add(`${k}/preview`);
    this.said.add(`${k}/continue`);
    if (g.distance <= NOW_AT) this.said.add(`${k}/now`);
    this.lastManeuverKey = k;
  }

  /**
   * Call for every update of the session (with the event, if there was one).
   * Returns the cues to play, most important first.
   */
  update(snapshot: NavSnapshot, event?: NavEvent): Cue[] {
    const cues: Cue[] = [];
    const g = snapshot.guidance;

    if (event) {
      switch (event.type) {
        case 'fix':
          if (event.first || !this.started) {
            this.started = true;
            if (snapshot.status === 'navigating' && g) {
              cues.push({
                key: 'start',
                sound: 'start',
                priority: 2,
                text: `Starting navigation to ${this.destinationName(snapshot)}. ${this.instruction(g, snapshot)}`,
              });
              this.markSpoken(g);
            }
          } else if (event.rerouted && g) {
            this.said.clear();
            cues.push({
              key: `relocated:${event.node.id}:${snapshot.rerouteCount}`,
              sound: 'reroute',
              priority: 2,
              text: `I've updated your position and the route. ${this.instruction(g, snapshot)}`,
            });
            this.markSpoken(g);
          } else {
            // Passing a marker: a soft tick, no words.
            cues.push({ key: `checkpoint:${event.node.id}`, sound: 'checkpoint', priority: 0, ttl: 1500 });
          }
          break;
        case 'reroute':
          this.said.clear();
          if (g) {
            cues.push({
              key: `reroute:${snapshot.rerouteCount}`,
              sound: 'reroute',
              priority: 2,
              text: `Route updated. ${this.instruction(g, snapshot)}`,
            });
            this.markSpoken(g);
          }
          break;
        case 'wrong-way':
          cues.push({
            key: `wrong-way:${snapshot.rerouteCount}:${Math.round(snapshot.remaining)}`,
            sound: 'warning',
            priority: 3,
            text: "You're heading the wrong way. Please turn around.",
          });
          break;
        case 'floor': {
          const floor = this.building.floor(event.floor);
          this.said.clear();
          cues.push({
            key: `floor:${event.floor}:${snapshot.rerouteCount}`,
            sound: 'floor',
            priority: 2,
            text: `You're on ${floor ? floor.spoken : `floor ${event.floor}`}.${g && snapshot.status === 'navigating' ? ` ${this.instruction(g, snapshot)}` : ''}`,
          });
          if (g) this.markSpoken(g);
          break;
        }
        case 'arrived':
          cues.push({
            key: `arrived:${snapshot.destination.id}`,
            sound: 'arrive',
            priority: 3,
            text: `You've arrived at ${this.destinationName(snapshot)}${this.sidePhrase(snapshot)}.`,
          });
          break;
        default:
          break;
      }
    }

    if (snapshot.status !== 'navigating' || !g || !this.started) return cues;

    // Staged announcements for the maneuver ahead.
    const m = g.maneuver;
    const k = this.key(m);
    const changed = k !== this.lastManeuverKey;
    this.lastManeuverKey = k;
    const once = (stage: string): boolean => {
      const id = `${k}/${stage}`;
      if (this.said.has(id)) return false;
      this.said.add(id);
      return true;
    };

    if (m.type === 'arrive') {
      if (g.distance <= 12 && g.distance > 4 && once('preview')) {
        cues.push({
          key: `${k}/preview`,
          priority: 1,
          ttl: 5000,
          text: `Your destination is ${spokenDistance(g.distance)} ahead${this.sidePhrase(snapshot)}.`,
        });
      } else if (changed && g.distance >= REASSURE_FROM && once('continue')) {
        cues.push({ key: `${k}/continue`, priority: 1, ttl: 5000, text: `Continue straight for ${spokenDistance(g.distance)}.` });
      }
    } else if (g.distance <= NOW_AT) {
      if (once('now')) {
        this.said.add(`${k}/preview`);
        cues.push({
          key: `${k}/now`,
          sound: 'turn',
          pan: sideOf(m.type),
          priority: 2,
          ttl: 4000,
          text: `${capital(this.action(m))}.`,
        });
      }
    } else if (g.distance <= PREVIEW_FROM && g.distance >= PREVIEW_MIN) {
      if (once('preview')) {
        cues.push({
          key: `${k}/preview`,
          priority: 1,
          ttl: 5000,
          text: `In ${spokenDistance(g.distance)}, ${this.action(m)}${this.where(m)}.`,
        });
      }
    } else if (changed && g.distance >= REASSURE_FROM && once('continue')) {
      cues.push({ key: `${k}/continue`, priority: 1, ttl: 5000, text: `Continue straight for ${spokenDistance(g.distance)}.` });
    }

    // The estimate has become vague: mention it once, gently.
    if (snapshot.needsRecalibration && !this.wasUncertain) {
      cues.push({
        key: `uncertain:${snapshot.lastFix ? snapshot.lastFix.node.id : 'x'}`,
        priority: 0,
        ttl: 6000,
        text: "I'm a little less sure where you are. If you pass a marker, point the camera at it.",
      });
    }
    this.wasUncertain = snapshot.needsRecalibration;

    return cues;
  }
}

/** For the UI: the name a node goes by when spoken. */
export function spokenNodeName(building: Building, node: NavNode): string {
  return spokenName(building.displayName(node));
}
