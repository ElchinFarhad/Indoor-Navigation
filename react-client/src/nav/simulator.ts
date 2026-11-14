/**
 * Demo mode: a simulated person walking the route.
 *
 * It produces exactly the inputs a real phone would (orientation samples,
 * steps, marker sightings), so the whole pipeline - tracker, re-routing,
 * guidance, AR overlay - can be tried on a desktop or shown without a
 * building full of QR codes.
 */
import { angleDiff, DEG, distance, Mat3 } from './geometry';
import { NavigationSession } from './navigator';
import { cameraToSensorWorld, headingOf } from './orientation';

export interface SimulatorCallbacks {
  onOrientation: (cameraToSensorWorld: Mat3, sensorHeading: number) => void;
  onStep: (lengthFactor: number) => void;
}

const STEP_SECONDS = 0.55;
const TURN_RATE = 140 * DEG; // radians per second
const TICK_MS = 40;

export class WalkSimulator {
  private session: NavigationSession;
  private callbacks: SimulatorCallbacks;
  private timer: any = null;
  private heading = 0;
  private sinceStep = 0;
  private elapsed = 0;
  private stairsTimer = 0;
  private lastMarker: number | null = null;
  /** Pause walking (the user "stops"). */
  paused = false;

  constructor(session: NavigationSession, callbacks: SimulatorCallbacks) {
    this.session = session;
    this.callbacks = callbacks;
  }

  /** Starts at the given node, as if its marker had just been scanned. */
  start(startNodeId: number) {
    const building = this.session.building;
    const node = building.node(startNodeId);
    if (!node) return;
    // Face the first corridor so the walk starts without a spin.
    const first = building.edgesFrom(startNodeId).find((e) => e.kind === 'walk');
    this.heading = first ? first.dir : 0;
    this.emitOrientation();
    this.sight(startNodeId);
    this.stop();
    this.timer = setInterval(this.tick, TICK_MS);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private sight(nodeId: number) {
    const node = this.session.building.node(nodeId)!;
    this.lastMarker = nodeId;
    this.session.handleSighting({
      node,
      code: { content: '', corners: [], center: [0, 0], size_px: 120, pose: null },
      heading: this.heading,
      cameraToWorld: null,
      offset: null,
      range: 1.3,
      cameraHeight: 1.3,
    });
  }

  private emitOrientation() {
    // A phone held upright and tipped 22 degrees towards the floor, with a
    // little hand sway. In this simulated sensor frame "north" is map-up.
    const sway = Math.sin(this.elapsed * 3.1) * 1.2;
    const alpha = -90 - this.heading / DEG + sway;
    const m = cameraToSensorWorld(alpha, 68 + Math.sin(this.elapsed * 2.3) * 1.5, 0);
    this.callbacks.onOrientation(m, headingOf(m));
  }

  private tick = () => {
    const dt = TICK_MS / 1000;
    this.elapsed += dt;
    const snap = this.session.snapshot;
    if (snap.status !== 'navigating' || !snap.route || !snap.position || this.paused) {
      this.emitOrientation();
      return;
    }

    if (snap.floorChange) {
      // "Climb" for a few seconds, then arrive at the marker on the landing.
      this.stairsTimer += dt;
      this.emitOrientation();
      if (this.stairsTimer > 3.5) {
        this.stairsTimer = 0;
        const landing = this.session.building.node(snap.floorChange.to);
        if (landing && landing.qr) this.sight(landing.id);
        else this.session.confirmFloorChange();
      }
      return;
    }
    this.stairsTimer = 0;

    // Turn towards the route, then walk.
    const leg = snap.route.legs[0];
    if (!leg || leg.kind !== 'walk') {
      this.emitOrientation();
      return;
    }
    const diff = angleDiff(leg.dir, this.heading);
    const turn = Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
    this.heading += turn;
    this.emitOrientation();

    if (Math.abs(diff) < 25 * DEG) {
      this.sinceStep += dt;
      if (this.sinceStep >= STEP_SECONDS) {
        this.sinceStep = 0;
        this.callbacks.onStep(0.95 + 0.1 * Math.sin(this.elapsed * 7));
        // Passing a marker: the camera catches it and the position is corrected.
        const after = this.session.snapshot;
        const pos = after.position;
        if (pos && after.status === 'navigating') {
          for (const id of [pos.from, pos.to]) {
            if (id === null || id === this.lastMarker) continue;
            const n = this.session.building.node(id)!;
            // (A phone held up for the arrows only catches a floor marker now and then.)
            if (n.qr && after.sinceFix > 14 && distance(pos, n) * this.session.building.metersPerUnit < 0.6) {
              this.sight(id);
              break;
            }
          }
        }
      }
    }
  };
}
