import { building } from '../../db/dijkstra';
import { Announcer, Cue, spokenDistance, spokenName } from '../announcer';
import { DEG, direction, distance, wrapAngle } from '../geometry';
import { NavigationSession } from '../navigator';

const MPU = building.metersPerUnit;
const byLabel = (label: string, floor = 0) => building.nodes.find((n) => n.label === label && n.floor === floor)!;

function sighting(label: string, heading: number | null, floor = 0) {
  return {
    node: byLabel(label, floor),
    code: { content: '', corners: [], center: [0, 0], size_px: 100, pose: null },
    heading,
    cameraToWorld: null,
    offset: null,
    range: 1.2,
    cameraHeight: 1.2,
  };
}

/** A session with an announcer attached; collects every cue in order. */
function guided(destLabel: string, floor = 0, options: { avoidStairs?: boolean } = {}) {
  const session = new NavigationSession(building, byLabel(destLabel, floor).id, { now: () => 0, ...options });
  const announcer = new Announcer(building);
  const cues: Cue[] = [];
  session.subscribe((snapshot, event) => {
    for (const cue of announcer.update(snapshot, event)) cues.push(cue);
  });
  return { session, cues };
}

/** Walks the session's own route, one 0.7 m step at a time, turning as the route turns. */
function walkRoute(session: NavigationSession, maxSteps = 400) {
  const start = session.snapshot.position!;
  const truth = { x: start.x, y: start.y };
  for (let i = 0; i < maxSteps; i++) {
    const snap = session.snapshot;
    if (snap.status !== 'navigating') break;
    if (snap.floorChange) {
      session.confirmFloorChange();
      const p = session.snapshot.position!;
      truth.x = p.x;
      truth.y = p.y;
      continue;
    }
    const leg = snap.route!.legs.find((l) => l.kind === 'walk' && l.length > 0.05);
    if (!leg) break;
    const dir = direction(snap.position!, leg.to);
    truth.x += Math.cos(dir) * 7;
    truth.y += Math.sin(dir) * 7;
    session.handleOrientation(wrapAngle(dir - 0.8));
    session.handleStep();
  }
  return truth;
}

describe('spoken forms', () => {
  it('rounds distances the way people say them', () => {
    expect(spokenDistance(3.4)).toBe('about 3 metres');
    expect(spokenDistance(11.6)).toBe('about 10 metres');
    expect(spokenDistance(23)).toBe('about 25 metres');
    expect(spokenDistance(47)).toBe('about 50 metres');
  });

  it('reads room codes naturally', () => {
    expect(spokenName('Seminar room 0.21')).toBe('Seminar room 0 21');
    expect(spokenName('Café')).toBe('Café');
  });
});

describe('announcements along a route (one scan at the entrance, then just walking)', () => {
  const run = () => {
    const g = guided('Classroom 0.40');
    g.session.handleOrientation(wrapAngle(-Math.PI / 2 - 0.8));
    g.session.handleSighting(sighting('Main entrance', -Math.PI / 2));
    const truth = walkRoute(g.session);
    return { ...g, truth };
  };

  it('reaches the destination without any further scan', () => {
    const { session, truth } = run();
    expect(session.snapshot.status).toBe('arrived');
    expect(distance(truth, byLabel('Classroom 0.40')) * MPU).toBeLessThan(1.5);
    expect(session.snapshot.arrivalConfirmed).toBe(false); // arrived by tracking, not by a marker
  });

  it('says each thing once, in a sensible order, in full sentences', () => {
    const { cues } = run();
    const spoken = cues.filter((c) => c.text).map((c) => c.text!);
    expect(spoken[0]).toBe('Starting navigation to Classroom 0 40. In about 8 metres, turn left, at the lobby.');
    expect(spoken).toContain('Turn left.');
    expect(spoken.some((t) => /^In about \d+ metres, turn right, at the south-west corner\.$/.test(t))).toBe(true);
    expect(spoken).toContain('Turn right.');
    expect(spoken[spoken.length - 1]).toBe("You've arrived at Classroom 0 40, on your left.");
    // Nothing is repeated.
    expect(new Set(cues.map((c) => c.key)).size).toBe(cues.length);
    // Every sentence ends properly and none is a fragment.
    for (const t of spoken) expect(/^[A-Z].*[.!]$/.test(t)).toBe(true);
    // It is not chatty: a 35 m walk with two turns needs only a handful of sentences.
    expect(spoken.length).toBeLessThanOrEqual(8);
  });

  it('pairs sounds with the right events and pans turn sounds to their side', () => {
    const { cues } = run();
    const sounds = cues.filter((c) => c.sound).map((c) => c.sound);
    expect(sounds[0]).toBe('start');
    expect(sounds[sounds.length - 1]).toBe('arrive');
    const turns = cues.filter((c) => c.sound === 'turn');
    expect(turns.length).toBe(2);
    expect(turns[0].pan!).toBeLessThan(0); // left
    expect(turns[1].pan!).toBeGreaterThan(0); // right
    // The turn prompt outranks the early heads-up, and arrival outranks everything.
    expect(turns[0].priority).toBeGreaterThan(cues.find((c) => /preview$/.test(c.key))!.priority);
    expect(cues[cues.length - 1].priority).toBe(3);
  });
});

describe('other situations', () => {
  it('announces stairs and the new floor', () => {
    const g = guided('Lab 1.30', 1);
    g.session.handleOrientation(wrapAngle(-Math.PI / 2 - 0.8));
    g.session.handleSighting(sighting('Main entrance', -Math.PI / 2));
    walkRoute(g.session);
    expect(g.session.snapshot.status).toBe('arrived');
    const spoken = g.cues.filter((c) => c.text).map((c) => c.text!);
    expect(spoken.some((t) => /take the stairs up to the first floor/i.test(t))).toBe(true);
    expect(spoken.some((t) => /^You're on the first floor\./.test(t))).toBe(true);
    expect(g.cues.some((c) => c.sound === 'floor')).toBe(true);
  });

  it('uses the lift on a step-free route', () => {
    const g = guided('Lab 1.30', 1, { avoidStairs: true });
    g.session.handleSighting(sighting('Main entrance', -Math.PI / 2));
    expect(g.session.snapshot.route!.legs.some((l) => l.kind === 'stairs')).toBe(false);
    walkRoute(g.session);
    expect(g.cues.some((c) => /take the lift up to the first floor/i.test(c.text || ''))).toBe(true);
  });

  it('passing a marker on the route is only a soft tick', () => {
    const g = guided('Café');
    g.session.handleOrientation(0);
    g.session.handleSighting(sighting('Main entrance', -Math.PI / 2));
    g.cues.length = 0;
    g.session.handleSighting(sighting('Lobby', null));
    expect(g.cues[0].sound).toBe('checkpoint');
    expect(g.cues[0].text).toBeUndefined();
    expect(g.cues[0].priority).toBe(0);
    // Nothing is said about the marker itself; the route did not change.
    expect(g.cues.some((c) => c.sound === 'reroute' || /position/.test(c.text || ''))).toBe(false);
    // Standing at the junction facing the hall, the next thing to do is the turn towards the café.
    expect(g.cues.filter((c) => c.text).map((c) => c.text)).toEqual(['Turn right.']);
  });

  it('a marker somewhere unexpected corrects the position and re-plans, and says so', () => {
    const g = guided('Café');
    g.session.handleOrientation(0);
    g.session.handleSighting(sighting('Main entrance', -Math.PI / 2));
    g.cues.length = 0;
    // The user turns out to be at the other end of the building.
    g.session.handleSighting(sighting('Office 0.20', null));
    expect(g.session.snapshot.position!.x).toBe(byLabel('Office 0.20').x);
    expect(g.session.snapshot.route!.nodeIds[0]).toBe(byLabel('Office 0.20').id);
    const said = g.cues.find((c) => c.text)!;
    expect(said.sound).toBe('reroute');
    expect(said.text!.indexOf("I've updated your position and the route.")).toBe(0);
  });

  it('warns once when walking the wrong way', () => {
    const g = guided('Café');
    g.session.handleOrientation(wrapAngle(Math.PI - 0.8));
    g.session.handleSighting(sighting('Lobby', Math.PI)); // facing away from the café
    for (let i = 0; i < 8; i++) g.session.handleStep();
    const warnings = g.cues.filter((c) => c.sound === 'warning');
    expect(warnings.length).toBe(1);
    expect(warnings[0].text).toBe("You're heading the wrong way. Please turn around.");
    expect(warnings[0].priority).toBe(3);
  });

  it('long routes stay well within the accuracy budget with a single scan', () => {
    // Entrance to the far first-floor office: about 70 m, five turns, one staircase, one scan.
    const g = guided('Office 1.20', 1);
    g.session.handleOrientation(wrapAngle(-Math.PI / 2 - 0.8));
    g.session.handleSighting(sighting('Main entrance', -Math.PI / 2));
    let worst = 0;
    g.session.subscribe((s) => {
      if (s.status === 'navigating') worst = Math.max(worst, s.accuracy);
    });
    walkRoute(g.session);
    expect(g.session.snapshot.status).toBe('arrived');
    expect(worst).toBeLessThan(5); // never had to ask for a marker
    expect(g.cues.some((c) => /less sure/.test(c.text || ''))).toBe(false);
  });

  it('keeps a calibrated heading when a later marker is only seen roughly', () => {
    const g = guided('Café');
    g.session.handleOrientation(0.3);
    g.session.handleSighting(sighting('Main entrance', -Math.PI / 2));
    const before = g.session.snapshot.heading!;
    // Seen in passing with a poor pose: the outline suggests a heading 40 degrees off.
    g.session.handleSighting(sighting('Lobby', before + 40 * DEG));
    expect(g.session.snapshot.heading!).toBeCloseTo(before);
    expect(g.session.snapshot.position!.y).toBe(byLabel('Lobby').y);
  });
});
