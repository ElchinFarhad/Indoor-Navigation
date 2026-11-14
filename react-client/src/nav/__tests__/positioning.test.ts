import { building } from '../../db/dijkstra';
import { angleDiff, DEG, direction, distance, mat3Multiply, wrapAngle } from '../geometry';
import { NavEvent, NavigationSession } from '../navigator';
import { cameraToSensorWorld, headingOf, pitchOf, yawMatrix } from '../orientation';
import { estimateFocalPx, interpretCode, markerToWorld, ScannedCode } from '../qrPose';
import { StepDetector } from '../stepDetector';
import { PositionTracker } from '../tracker';

const id = (name: string, floor = 0) => building.nodes.find((n) => n.name === name && n.floor === floor)!.id;
const node = (name: string, floor = 0) => building.node(id(name, floor))!;
const MPU = building.metersPerUnit;

/** Deterministic pseudo random numbers in [-1, 1]. */
function noiseSource(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return (s / 4294967296) * 2 - 1;
  };
}

describe('device orientation', () => {
  it('phone flat on a table, top edge pointing "north": camera looks down, heading is map-up', () => {
    const m = cameraToSensorWorld(0, 0, 0);
    expect(pitchOf(m)).toBeCloseTo(-Math.PI / 2);
    expect(headingOf(m)).toBeCloseTo(-Math.PI / 2); // map up = -y
  });

  it('phone held upright: camera looks at the horizon, same heading', () => {
    const m = cameraToSensorWorld(0, 90, 0);
    expect(pitchOf(m)).toBeCloseTo(0);
    expect(headingOf(m)).toBeCloseTo(-Math.PI / 2);
  });

  it('turning the body to the right increases the heading, whatever the tilt', () => {
    for (const beta of [0, 30, 60, 90]) {
      const a = headingOf(cameraToSensorWorld(0, beta, 0));
      // alpha grows counter clockwise seen from above, so turning right lowers it.
      const b = headingOf(cameraToSensorWorld(-90, beta, 0));
      expect(angleDiff(b, a)).toBeCloseTo(Math.PI / 2);
    }
  });

  it('the calibration offset rotates headings about the vertical', () => {
    const m = cameraToSensorWorld(40, 70, 5);
    const rotated = mat3Multiply(yawMatrix(0.7), m);
    expect(angleDiff(headingOf(rotated), headingOf(m))).toBeCloseTo(0.7);
    expect(pitchOf(rotated)).toBeCloseTo(pitchOf(m));
  });

  it('landscape pages report the same heading as portrait ones', () => {
    // The same upright phone rotated into landscape (top edge to the left):
    // the device axes are x = up, y = west, z = south, i.e. alpha 90, beta 0, gamma -90.
    const portrait = headingOf(cameraToSensorWorld(0, 90, 0, 0));
    const landscape = headingOf(cameraToSensorWorld(90, 0, -90, 90));
    expect(angleDiff(landscape, portrait)).toBeCloseTo(0);
  });
});

describe('QR pose interpretation', () => {
  const code = (content: string, r: number[], t: number[], size = 120): ScannedCode => ({
    content,
    corners: [[260, 180], [380, 180], [380, 300], [260, 300]],
    center: [320, 240],
    size_px: size,
    pose: { r, t, err_px: 0.3 },
  });
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  it('looking straight down at a floor marker, top of the phone towards map-up', () => {
    const s = interpretCode(building, code('http://localhost:3000/qrScanner/0', IDENTITY, [0, 0, 6]))!;
    expect(s.node.name).toBe('A');
    expect(s.heading!).toBeCloseTo(-Math.PI / 2);
    expect(s.offset!.x).toBeCloseTo(0);
    expect(s.offset!.y).toBeCloseTo(0);
    expect(s.cameraHeight!).toBeCloseTo(6 * 0.18);
    expect(s.range!).toBeCloseTo(6 * 0.18);
  });

  it('marker appearing rotated clockwise means the user is turned counter clockwise', () => {
    // The code appears rotated by +90 degrees in the image (its top edge points to image-right),
    // i.e. the phone's top edge points towards the code's LEFT edge = map left (heading 180 deg).
    const rz90 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const s = interpretCode(building, code('http://x/qrScanner/1', rz90, [0, 0, 5]))!;
    expect(Math.abs(angleDiff(s.heading!, Math.PI))).toBeLessThan(1e-9);
  });

  it('falls back to the outline when the pose is poor, and ignores foreign codes', () => {
    const bad: ScannedCode = { ...code('http://x/qrScanner/2', IDENTITY, [0, 0, 5]), pose: { r: IDENTITY, t: [0, 0, 5], err_px: 40 } };
    const s = interpretCode(building, bad)!;
    expect(s.cameraToWorld).toBeNull();
    expect(s.offset).toBeNull();
    expect(s.heading!).toBeCloseTo(-Math.PI / 2);
    expect(interpretCode(building, code('https://example.org', IDENTITY, [0, 0, 5]))).toBeNull();
    expect(interpretCode(building, code('http://x/qrScanner/999', IDENTITY, [0, 0, 5]))).toBeNull();
  });

  it('reports where the camera is relative to the marker', () => {
    // Marker 2 side lengths to the right of the optical axis => camera is to the marker's left (map -x).
    const s = interpretCode(building, code('http://x/qrScanner/0', IDENTITY, [2, 0, 6]))!;
    expect(s.offset!.x).toBeCloseTo((-2 * 0.18) / MPU);
    expect(s.offset!.y).toBeCloseTo(0);
  });

  it('handles wall mounted markers', () => {
    // A wall marker facing map-down (the wall is "above" it on the map); the user faces it head on.
    const m = markerToWorld({ mount: 'wall', rotation: 0, facing: Math.PI / 2, size: 0.2 });
    // Camera axes == QR axes when looking straight at it; forward is into the wall = map up.
    expect(headingOf(m)).toBeCloseTo(-Math.PI / 2);
  });

  it('estimates a plausible focal length', () => {
    expect(estimateFocalPx(640, 480)).toBeGreaterThan(450);
    expect(estimateFocalPx(640, 480)).toBeLessThan(560);
    expect(estimateFocalPx(480, 640)).toBeCloseTo(estimateFocalPx(640, 480));
  });
});

describe('step detector', () => {
  const walk = (detector: StepDetector, seconds: number, stepHz: number, amplitude: number, start = 0) => {
    let steps = 0;
    for (let t = 0; t < seconds; t += 1 / 60) {
      const a = 9.81 + amplitude * Math.sin(2 * Math.PI * stepHz * t) + 0.15 * Math.sin(40 * t);
      if (detector.push(0.3, a * 0.6, a * 0.8, (start + t) * 1000)) steps++;
    }
    return steps;
  };

  it('counts one step per bounce while walking', () => {
    const steps = walk(new StepDetector(), 10, 1.8, 2.5);
    expect(steps).toBeGreaterThanOrEqual(17);
    expect(steps).toBeLessThanOrEqual(19);
  });

  it('does not count steps while standing or gently moving the phone', () => {
    expect(walk(new StepDetector(), 10, 1.8, 0.25)).toBe(0);
    expect(walk(new StepDetector(), 5, 0.3, 0.6)).toBe(0);
  });

  it('gives longer steps for a stronger bounce', () => {
    const lengths = (amplitude: number) => {
      const d = new StepDetector();
      const out: number[] = [];
      for (let t = 0; t < 8; t += 1 / 60) {
        const s = d.push(0, 0, 9.81 + amplitude * Math.sin(2 * Math.PI * 1.8 * t), t * 1000);
        if (s) out.push(s.length);
      }
      return out.reduce((a, b) => a + b, 0) / out.length;
    };
    expect(lengths(4)).toBeGreaterThan(lengths(1.6));
    expect(lengths(2.5)).toBeGreaterThan(0.5);
    expect(lengths(2.5)).toBeLessThan(0.9);
  });
});

/**
 * Simulates a person walking through a list of waypoints. The simulated
 * orientation sensor has an arbitrary constant bias (as real ones do indoors),
 * per-step heading noise and a slow drift; the person's real step length
 * differs from the tracker's initial guess.
 */
function simulateWalk(
  session: NavigationSession,
  waypoints: Array<{ x: number; y: number }>,
  opts: { stepLength?: number; bias?: number; noiseDeg?: number; driftDegPerStep?: number; seed?: number; onStep?: (truth: { x: number; y: number }, steps: number) => void } = {}
) {
  const L = (opts.stepLength || 0.7) / MPU;
  const rnd = noiseSource(opts.seed || 7);
  const bias = opts.bias !== undefined ? opts.bias : 1.234;
  let drift = 0;
  let steps = 0;
  const truth = { ...waypoints[0] };
  for (let i = 1; i < waypoints.length; i++) {
    const target = waypoints[i];
    while (distance(truth, target) > L * 0.5) {
      const dir = direction(truth, target);
      const stride = Math.min(L, distance(truth, target));
      truth.x += Math.cos(dir) * stride;
      truth.y += Math.sin(dir) * stride;
      drift += (opts.driftDegPerStep || 0) * DEG;
      const sensed = wrapAngle(dir - bias + drift + rnd() * (opts.noiseDeg !== undefined ? opts.noiseDeg : 6) * DEG);
      session.handleOrientation(sensed);
      session.handleStep();
      steps++;
      if (opts.onStep) opts.onStep(truth, steps);
    }
  }
  return { truth, steps };
}

/** A marker sighting as the scanner would produce it for a user facing `heading`. */
function sighting(name: string, heading: number | null, floor = 0) {
  return {
    node: node(name, floor),
    code: { content: '', corners: [], center: [0, 0], size_px: 100, pose: null },
    heading,
    cameraToWorld: null,
    offset: null,
    range: 1.2,
    cameraHeight: 1.2,
  };
}

function errorMeters(session: NavigationSession, truth: { x: number; y: number }) {
  return distance(session.snapshot.position!, truth) * MPU;
}

describe('tracking between markers', () => {
  it('follows the thesis route C -> B -> A -> D from a single scan', () => {
    const bias = 0.9;
    const session = new NavigationSession(building, id('D'), { now: () => 0 });
    const events: NavEvent[] = [];
    session.subscribe((_s, e) => e && events.push(e));

    // Facing down the corridor towards B when scanning C; the sensor reads something unrelated.
    session.handleOrientation(wrapAngle(Math.PI / 2 - bias));
    session.handleSighting(sighting('C', Math.PI / 2));
    expect(session.snapshot.status).toBe('navigating');
    expect(session.snapshot.route!.nodeIds).toEqual([2, 1, 0, 3]);
    expect(session.snapshot.guidance!.headline).toBe('In 4 m, turn left');

    let worst = 0;
    const { truth } = simulateWalk(session, [node('C'), node('B'), node('A'), node('D')], {
      bias,
      onStep: (t) => {
        if (session.snapshot.status !== 'arrived') worst = Math.max(worst, errorMeters(session, t));
      },
    });

    expect(session.snapshot.status).toBe('arrived');
    expect(worst).toBeLessThan(2.0);
    expect(distance(truth, node('D')) * MPU).toBeLessThan(1.5);
    expect(events.filter((e) => e.type === 'reroute')).toEqual([]);
    expect(events.some((e) => e.type === 'approach')).toBe(true);
    expect(events[events.length - 1].type).toBe('arrived');
  });

  it('snaps onto the junction when the user turns, absorbing step length error', () => {
    // The user's steps are 15% longer than the tracker assumes.
    const session = new NavigationSession(building, id('D'), { now: () => 0, stepLength: 0.6 });
    session.handleOrientation(wrapAngle(Math.PI / 2 - 1.234));
    session.handleSighting(sighting('F', Math.PI / 2));
    const errors: number[] = [];
    simulateWalk(session, [node('F'), node('C'), node('B'), node('A')], {
      stepLength: 0.7,
      onStep: (t) => errors.push(errorMeters(session, t)),
    });
    // Without the snap the error would keep growing (15% of ~21 m > 3 m).
    expect(errors[errors.length - 1]).toBeLessThan(1.6);
  });

  it('re-routes when the user takes a wrong turn', () => {
    const session = new NavigationSession(building, id('D'), { now: () => 0 });
    const events: NavEvent[] = [];
    session.subscribe((_s, e) => e && events.push(e));
    session.handleOrientation(wrapAngle(Math.PI - 1.234));
    session.handleSighting(sighting('A', Math.PI)); // facing left, away from D
    expect(session.snapshot.route!.nodeIds).toEqual([id('A'), id('D')]);
    expect(session.snapshot.guidance!.maneuver.type).toBe('uturn');

    // Walks left towards B instead of right towards D.
    simulateWalk(session, [node('A'), { x: 110, y: 260 }]);
    const snap = session.snapshot;
    expect(snap.wrongWay).toBe(true);
    expect(events.some((e) => e.type === 'wrong-way')).toBe(true);
    expect(snap.route!.nodeIds[0]).toBe(id('A'));
    expect(snap.guidance!.maneuver.type).toBe('uturn');
    expect(snap.remaining).toBeGreaterThan(building.edge(id('A'), id('D'))!.length + 3);

    // Carries on all the way round to F: the route now changes.
    simulateWalk(session, [{ x: 110, y: 260 }, node('B'), node('C'), node('F')]);
    // Turning back through A is still the shortest way: same plan, no re-route announced.
    expect(events.some((e) => e.type === 'reroute')).toBe(false);
    expect(session.snapshot.route!.nodeIds.map((n) => building.node(n)!.name)).toEqual(['C', 'B', 'A', 'D']);
    simulateWalk(session, [node('F'), node('G'), node('H'), node('J'), node('K')]);
    expect(events.some((e) => e.type === 'reroute')).toBe(true);
    const names = session.snapshot.route!.nodeIds.map((n) => building.node(n)!.name);
    expect(names[names.length - 1]).toBe('D');
    expect(names).toContain('L');
  });

  it('corrects drift at the next marker and learns the step length', () => {
    const session = new NavigationSession(building, id('G'), { now: () => 0, stepLength: 0.6 });
    const events: NavEvent[] = [];
    session.subscribe((_s, e) => e && events.push(e));
    session.handleOrientation(wrapAngle(-Math.PI / 2 - 1.234));
    session.handleSighting(sighting('C', -Math.PI / 2));
    const { truth } = simulateWalk(session, [node('C'), node('F')], { stepLength: 0.72, noiseDeg: 4 });
    const before = errorMeters(session, truth);
    expect(before).toBeGreaterThan(0.8); // step length mismatch shows up as distance error
    const accuracyBefore = session.snapshot.accuracy;

    session.handleSighting(sighting('F', -Math.PI / 2));
    expect(errorMeters(session, node('F'))).toBeLessThan(0.01);
    expect(session.snapshot.accuracy).toBeLessThan(accuracyBefore);
    expect(session.tracker.stepLength).toBeGreaterThan(0.62);
    const fix = events.filter((e) => e.type === 'fix').pop() as any;
    expect(fix.correction).toBeGreaterThan(0.8);

    // With the learned step length the next stretch is tracked better.
    const second = simulateWalk(session, [node('F'), node('G')], { stepLength: 0.72, noiseDeg: 4 });
    expect(session.snapshot.status).toBe('arrived');
    expect(distance(second.truth, node('G')) * MPU).toBeLessThan(1.6);
  });

  it('cancels slow heading drift by walking along corridors', () => {
    const session = new NavigationSession(building, id('G'), { now: () => 0 });
    session.handleOrientation(wrapAngle(-Math.PI / 2 - 1.234));
    session.handleSighting(sighting('C', -Math.PI / 2));
    const offsetBefore = session.tracker.calibration!;
    // 0.3 degrees of gyro drift per step: 8 degrees over these two corridors if uncorrected.
    const { steps } = simulateWalk(session, [node('C'), node('F'), { x: 67, y: 60 }], { noiseDeg: 1, driftDegPerStep: 0.3 });
    const drift = steps * 0.3 * DEG;
    const followed = Math.abs(angleDiff(session.tracker.calibration!, offsetBefore));
    expect(followed).toBeGreaterThan(drift * 0.4); // the calibration followed the drift...
    // ...so the heading error stays well below the accumulated drift.
    const sensed = wrapAngle(direction(node('F'), node('G')) - 1.234 + drift);
    session.handleOrientation(sensed);
    expect(Math.abs(angleDiff(session.tracker.heading!, direction(node('F'), node('G'))))).toBeLessThan(drift * 0.6);
  });

  it('grows the accuracy radius while walking and asks for a marker when it gets large', () => {
    const tracker = new PositionTracker(building);
    tracker.onSensorHeading(0);
    tracker.applyFix({ nodeId: id('B'), heading: 0 });
    expect(tracker.accuracy).toBeCloseTo(0.5);
    for (let i = 0; i < 6; i++) tracker.onStep();
    const afterWalking = tracker.accuracy;
    expect(afterWalking).toBeGreaterThan(0.8);
    expect(afterWalking).toBeLessThan(1.2);
    // Steps that fit no corridor (user wandering) degrade it much faster.
    tracker.onSensorHeading(Math.PI / 2);
    for (let i = 0; i < 20; i++) tracker.onStep();
    expect(tracker.accuracy).toBeGreaterThan(5);
    expect(tracker.position!.y).toBeCloseTo(260); // ...and do not move the estimate through walls
  });

  it('keeps working without an orientation sensor by following the route', () => {
    const session = new NavigationSession(building, id('D'), { now: () => 0 });
    session.handleSighting(sighting('B', null));
    for (let i = 0; i < 12; i++) session.handleStep();
    const p = session.snapshot.position!;
    expect(p.y).toBeCloseTo(260);
    expect(p.x).toBeGreaterThan(65 + 60);
    expect(session.snapshot.headingCalibrated).toBe(false);
    session.handleSighting(sighting('A', null));
    expect(session.snapshot.position!.x).toBeCloseTo(155);
  });

  it('bootstraps the heading from the walking direction when the marker gave none', () => {
    const session = new NavigationSession(building, id('D'), { now: () => 0 });
    session.handleOrientation(2.5);
    session.handleSighting(sighting('B', null));
    expect(session.snapshot.heading).toBeNull();
    session.handleStep();
    session.handleStep();
    expect(session.snapshot.heading!).toBeCloseTo(0); // B -> A points right
    expect(session.snapshot.headingCalibrated).toBe(false);
  });
});

describe('floors', () => {
  it('guides up the stairs and continues on the other floor', () => {
    const session = new NavigationSession(building, id('R', 1), { now: () => 0 });
    const events: NavEvent[] = [];
    session.subscribe((_s, e) => e && events.push(e));
    session.handleOrientation(wrapAngle(-Math.PI / 2 - 1.234));
    session.handleSighting(sighting('H', -Math.PI / 2));
    expect(session.snapshot.guidance!.maneuver.type).toBe('stairs-up');

    simulateWalk(session, [node('H'), node('J')]);
    let snap = session.snapshot;
    expect(snap.floorChange).not.toBeNull();
    expect(snap.floorChange!.toFloor).toBe(1);
    expect(snap.guidance!.headline).toBe('Take the stairs up');

    // Steps on the stairs do not move the user on the map.
    for (let i = 0; i < 15; i++) session.handleStep();
    expect(session.snapshot.position!.floor).toBe(0);

    session.confirmFloorChange();
    snap = session.snapshot;
    expect(snap.position!.floor).toBe(1);
    expect(snap.floorChange).toBeNull();
    expect(events.some((e) => e.type === 'floor' && e.floor === 1)).toBe(true);

    simulateWalk(session, [node('N', 1), node('Q', 1), node('R', 1)]);
    expect(session.snapshot.status).toBe('arrived');
  });

  it('a marker on the other floor confirms the floor change by itself', () => {
    const session = new NavigationSession(building, id('P', 1), { now: () => 0 });
    session.handleSighting(sighting('J', null));
    expect(session.snapshot.floorChange).not.toBeNull();
    session.handleSighting(sighting('N', 0, 1));
    expect(session.snapshot.position!.floor).toBe(1);
    expect(session.snapshot.floorChange).toBeNull();
    expect(session.snapshot.route!.nodeIds.map((n) => building.node(n)!.name)).toEqual(['N', 'O', 'P']);
  });

  it('lets the user decline the stairs', () => {
    const session = new NavigationSession(building, id('P', 1), { now: () => 0 });
    session.handleOrientation(0);
    session.handleSighting(sighting('J', 0));
    expect(session.snapshot.floorChange).not.toBeNull();
    session.cancelFloorChange();
    expect(session.snapshot.floorChange).toBeNull();
    for (let i = 0; i < 4; i++) session.handleStep(); // walks on towards K
    expect(session.snapshot.position!.x).toBeGreaterThan(149 + 15);
    expect(session.snapshot.position!.floor).toBe(0);
  });
});

describe('arrival and edge cases', () => {
  it('arrives immediately when the scanned marker is the destination', () => {
    const session = new NavigationSession(building, id('D'), { now: () => 0 });
    const events: NavEvent[] = [];
    session.subscribe((_s, e) => e && events.push(e));
    session.handleSighting(sighting('D', 0));
    expect(session.snapshot.status).toBe('arrived');
    expect((events.find((e) => e.type === 'arrived') as any).confirmedByMarker).toBe(true);
  });

  it('ignores markers that are implausibly far away', () => {
    const session = new NavigationSession(building, id('D'), { now: () => 0 });
    expect(session.handleSighting({ ...sighting('A', 0), range: 15 })).toBe(false);
    expect(session.snapshot.status).toBe('locating');
  });

  it('can switch destination mid-way without losing the position', () => {
    const session = new NavigationSession(building, id('D'), { now: () => 0 });
    session.handleSighting(sighting('A', 0));
    session.setDestination(id('G'));
    expect(session.snapshot.destination.name).toBe('G');
    expect(session.snapshot.route!.nodeIds[0]).toBe(id('A'));
    expect(session.snapshot.status).toBe('navigating');
  });

  it('starts on the corridor the user is actually standing in when the marker is seen from a distance', () => {
    const tracker = new PositionTracker(building);
    // 1.5 m to the right of marker B (towards A).
    tracker.applyFix({ nodeId: id('B'), heading: Math.PI, offset: { x: 15, y: 1 } });
    const p = tracker.position!;
    expect(p.to).toBe(id('A'));
    expect(p.x).toBeCloseTo(80, 0);
  });
});
