/**
 * One navigation session: "take me to room X".
 *
 * The session owns the position tracker and keeps the route, the turn-by-turn
 * guidance and the status up to date as inputs arrive:
 *
 *   marker sightings (QR)  -> exact position + heading calibration
 *   orientation samples    -> where the user is facing
 *   steps                  -> movement between markers
 *
 * The route is recomputed from the current position after every movement, so
 * leaving the planned path simply produces a new route ("re-routing") without
 * any special case.
 */
import { Building, NavNode } from './building';
import { angleDiff, DEG } from './geometry';
import { buildManeuvers, Guidance, guidanceAt, Maneuver } from './instructions';
import { MarkerSighting } from './qrPose';
import { findRoute, Route, RouteOptions } from './routing';
import { PendingFloorChange, PositionTracker, TrackedPosition } from './tracker';

export type NavStatus = 'locating' | 'navigating' | 'arrived' | 'unreachable';

export type NavEvent =
  | { type: 'fix'; node: NavNode; correction: number | null; first: boolean; rerouted: boolean }
  | { type: 'reroute' }
  | { type: 'wrong-way' }
  | { type: 'floor'; floor: number }
  | { type: 'approach'; maneuver: Maneuver }
  | { type: 'arrived'; confirmedByMarker: boolean };

export interface NavSnapshot {
  status: NavStatus;
  destination: NavNode;
  position: TrackedPosition | null;
  /** Direction the user is facing on the map (radians) or null if unknown. */
  heading: number | null;
  headingCalibrated: boolean;
  /** Accuracy radius of the position, metres. */
  accuracy: number;
  route: Route | null;
  maneuvers: Maneuver[];
  guidance: Guidance | null;
  /** Remaining walking distance, metres. */
  remaining: number;
  etaSeconds: number;
  /** The user is walking away from the destination along the route. */
  wrongWay: boolean;
  /** The estimate has drifted enough that a marker scan is recommended. */
  needsRecalibration: boolean;
  floorChange: PendingFloorChange | null;
  /** Next marker the user will pass on the route. */
  nextMarker: NavNode | null;
  lastFix: { node: NavNode; at: number; correction: number | null } | null;
  rerouteCount: number;
  arrivalConfirmed: boolean;
  /** Metres walked since the position was last fixed by a marker. */
  sinceFix: number;
  /** Where the destination's door will be when the user gets there. */
  destinationSide: 'left' | 'right' | 'ahead' | null;
  /** Step-free routing (no stairs) is on. */
  stepFree: boolean;
  /** Increases with every change; handy as a React key / memo dependency. */
  version: number;
}

export type NavListener = (snapshot: NavSnapshot, event?: NavEvent) => void;

const ARRIVAL_RADIUS = 1.2; // metres
const RECALIBRATE_ABOVE = 5; // metres of accuracy radius
const WALKING_SPEED = 1.2; // m/s
const MAX_MARKER_RANGE = 6; // metres

function isSuffix(short: number[], long: number[]): boolean {
  if (short.length > long.length) return false;
  const shift = long.length - short.length;
  for (let i = 0; i < short.length; i++) if (short[i] !== long[i + shift]) return false;
  return true;
}

export class NavigationSession {
  readonly building: Building;
  readonly tracker: PositionTracker;

  private destId: number;
  private status: NavStatus = 'locating';
  private route: Route | null = null;
  private maneuvers: Maneuver[] = [];
  private guidance: Guidance | null = null;
  private wrongWaySteps = 0;
  private rerouteCount = 0;
  private lastRerouteAt = -Infinity;
  private lastFixEventAt = -Infinity;
  private lastFix: NavSnapshot['lastFix'] = null;
  private arrivalConfirmed = false;
  private announced: string | null = null;
  private listeners = new Set<NavListener>();
  private current: NavSnapshot;
  private version = 0;
  private lastHeadingNotify = -Infinity;
  private notifiedHeading: number | null = null;
  private now: () => number;
  private routeOptions: RouteOptions = {};

  /** Camera orientation measured from the last marker, for devices without an orientation sensor. */
  lastSighting: { sighting: MarkerSighting; at: number } | null = null;

  constructor(
    building: Building,
    destId: number,
    options: { now?: () => number; stepLength?: number; avoidStairs?: boolean } = {}
  ) {
    this.building = building;
    this.destId = destId;
    this.routeOptions = { avoidStairs: !!options.avoidStairs };
    this.now = options.now || (() => Date.now());
    this.tracker = new PositionTracker(building, { stepLength: options.stepLength });
    this.current = this.buildSnapshot();
  }

  get snapshot(): NavSnapshot {
    return this.current;
  }

  get destination(): NavNode {
    return this.building.node(this.destId)!;
  }

  subscribe(listener: NavListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ----------------------------------------------------------------- inputs */

  /** A QR marker of this building was seen by the camera. */
  handleSighting(sighting: MarkerSighting): boolean {
    if (sighting.range !== null && sighting.range > MAX_MARKER_RANGE) return false;
    const at = this.now();
    const first = !this.tracker.hasFix;
    const floorBefore = this.tracker.position ? this.tracker.position.floor : null;
    // The first scan sets the heading however it can. Later sightings happen
    // in passing, often from an awkward angle: they always correct the
    // position, but only a solid 3D pose is allowed to overrule a heading
    // calibration that is already in place.
    const trustHeading = sighting.cameraToWorld !== null || !this.tracker.headingCalibrated;
    const result = this.tracker.applyFix({
      nodeId: sighting.node.id,
      heading: trustHeading ? sighting.heading : null,
      offset: sighting.offset,
      time: at,
    });
    if (!result) return false;
    this.lastSighting = { sighting, at };
    this.lastFix = { node: result.node, at, correction: result.correction };
    this.wrongWaySteps = 0;

    const events: NavEvent[] = [];
    if (result.newMarker || at - this.lastFixEventAt > 4000) {
      this.lastFixEventAt = at;
      events.push({ type: 'fix', node: result.node, correction: result.correction, first, rerouted: false });
    }
    if (floorBefore !== null && floorBefore !== result.node.floor) {
      events.push({ type: 'floor', floor: result.node.floor });
    }
    if (this.status !== 'arrived' && result.node.id === this.destId) {
      this.arrivalConfirmed = true;
    }
    this.refresh(events, result.newMarker || first);
    return true;
  }

  /** Start position chosen by hand (no marker in sight). */
  setStart(nodeId: number): boolean {
    const first = !this.tracker.hasFix;
    if (!this.tracker.setManualPosition(nodeId)) return false;
    const node = this.building.node(nodeId)!;
    this.lastFix = { node, at: this.now(), correction: null };
    this.refresh([{ type: 'fix', node, correction: null, first, rerouted: false }], true);
    return true;
  }

  /**
   * Where the user should face to set off along the route: the direction of the
   * first corridor and the node at its end. `null` when the route does not start
   * with a walk (stairs, lift) or there is no route.
   */
  facingTarget(): { dir: number; node: NavNode | null } | null {
    const leg = this.route ? this.route.legs[0] : null;
    if (!leg || leg.kind !== 'walk' || leg.length < 0.5) return null;
    const node = leg.to.nodeId !== null ? this.building.node(leg.to.nodeId) || null : null;
    return { dir: leg.dir, node };
  }

  /** The user says they are facing along the start of the route. */
  confirmFacing(): boolean {
    const target = this.facingTarget();
    if (!target || !this.tracker.hasFix) return false;
    this.tracker.setFacing(target.dir);
    this.refresh([], false);
    return true;
  }

  /** Heading from the orientation sensor (uncalibrated, radians). */
  handleOrientation(sensorHeading: number) {
    this.tracker.onSensorHeading(sensorHeading);
    const heading = this.tracker.heading;
    const at = this.now();
    const moved =
      heading !== null && (this.notifiedHeading === null || Math.abs(angleDiff(heading, this.notifiedHeading)) > 3 * DEG);
    if (moved && at - this.lastHeadingNotify > 150) {
      this.lastHeadingNotify = at;
      this.refresh([], false);
    }
  }

  /** A step was detected. */
  handleStep(lengthFactor = 1) {
    if (!this.tracker.hasFix || this.status === 'arrived') return;
    this.tracker.onStep(lengthFactor);
    this.refresh([], false, true);
  }

  /** Position from the WebXR session's motion tracking (map units). */
  handleExternalPosition(x: number, y: number) {
    if (!this.tracker.hasFix || this.status === 'arrived') return;
    if (this.tracker.setExternalPosition(x, y)) this.refresh([], false, true);
  }

  /** The WebXR session ended: go back to counting steps. */
  endExternalTracking() {
    this.tracker.endExternalTracking();
  }

  confirmFloorChange() {
    const pending = this.tracker.awaitingFloorChange;
    if (pending && this.tracker.confirmFloorChange()) {
      this.refresh([{ type: 'floor', floor: pending.toFloor }], true);
    }
  }

  cancelFloorChange() {
    this.tracker.cancelFloorChange();
    this.refresh([], false);
  }

  /** Turns step-free routing (lifts instead of stairs) on or off. */
  setStepFree(on: boolean) {
    if (!!this.routeOptions.avoidStairs === on) return;
    this.routeOptions = { avoidStairs: on };
    this.tracker.cancelFloorChange();
    this.refresh([], true);
  }

  /** Switches to another destination without losing the current position. */
  setDestination(destId: number) {
    if (!this.building.node(destId)) return;
    this.destId = destId;
    this.status = this.tracker.hasFix ? 'navigating' : 'locating';
    this.arrivalConfirmed = false;
    this.route = null;
    this.announced = null;
    this.refresh([], true);
  }

  /* -------------------------------------------------------------- internals */

  private refresh(events: NavEvent[], quietReroute: boolean, afterStep = false) {
    const pos = this.tracker.position;
    if (pos && this.status !== 'arrived') {
      const start = pos.to === null ? { nodeId: pos.from } : { from: pos.from, to: pos.to, t: pos.t };
      const route = findRoute(this.building, start, this.destId, this.routeOptions);
      if (!route) {
        this.status = 'unreachable';
        this.route = null;
        this.maneuvers = [];
        this.guidance = null;
      } else {
        // Did the plan change, or is this just the old route getting shorter?
        const previous = this.route;
        // (Walking backwards makes the same route longer at the front; that is not a new plan either.)
        const samePlan =
          !previous || isSuffix(route.nodeIds, previous.nodeIds) || isSuffix(previous.nodeIds, route.nodeIds);
        if (this.status === 'navigating' && !samePlan) {
          this.rerouteCount++;
          if (quietReroute) {
            // A marker put the user somewhere the old plan did not pass through:
            // the fix itself reports that the route changed.
            for (const e of events) if (e.type === 'fix' && !e.first) e.rerouted = true;
          } else {
            const at = this.now();
            if (at - this.lastRerouteAt > 3000) {
              this.lastRerouteAt = at;
              events.push({ type: 'reroute' });
            }
          }
        }
        this.route = route;
        this.status = 'navigating';
        this.tracker.setRoute(route);

        // Walking along a corridor while the route leads back the other way.
        const heading = this.tracker.heading;
        const first = route.legs[0];
        const walkingAway = pos.to !== null && first !== undefined && route.nodeIds[0] === pos.from && pos.t > 0.3;
        if (afterStep) {
          const before = this.wrongWaySteps;
          this.wrongWaySteps = walkingAway ? this.wrongWaySteps + 1 : 0;
          if (before < 3 && this.wrongWaySteps >= 3) events.push({ type: 'wrong-way' });
        } else if (!walkingAway) {
          this.wrongWaySteps = 0;
        }

        // Which direction is the user coming from, for the very first instruction?
        let incoming: number | null = null;
        if (first && first.kind === 'walk') {
          const facingAway = heading !== null && Math.abs(angleDiff(heading, first.dir)) > 135 * DEG;
          if (pos.to === null) {
            incoming = heading !== null ? heading : this.tracker.travelDirection;
          } else if (this.wrongWaySteps >= 3 || (facingAway && this.tracker.headingCalibrated)) {
            incoming = first.dir + Math.PI;
          }
        }
        this.maneuvers = buildManeuvers(this.building, route, incoming);
        this.guidance = guidanceAt(this.maneuvers, 0);

        // Announce a maneuver once when the user gets close to it.
        const g = this.guidance;
        if (g && g.maneuver.type !== 'arrive' && g.distance <= 4) {
          const key = `${g.maneuver.type}@${g.maneuver.pointIndex}:${route.points[g.maneuver.pointIndex].nodeId}`;
          if (key !== this.announced) {
            this.announced = key;
            events.push({ type: 'approach', maneuver: g.maneuver });
          }
        }

        const destination = this.destination;
        const close = route.length <= ARRIVAL_RADIUS && pos.floor === destination.floor && !this.tracker.awaitingFloorChange;
        if (this.arrivalConfirmed || close) {
          this.status = 'arrived';
          events.push({ type: 'arrived', confirmedByMarker: this.arrivalConfirmed });
        }
      }
    }

    this.current = this.buildSnapshot();
    this.notifiedHeading = this.current.heading;
    if (events.length === 0) {
      this.emit(undefined);
    } else {
      for (const e of events) this.emit(e);
    }
  }

  private emit(event: NavEvent | undefined) {
    this.listeners.forEach((l) => l(this.current, event));
  }

  /** On which side the destination's door is for somebody arriving along the route. */
  private destinationSide(route: Route | null): 'left' | 'right' | 'ahead' | null {
    const destination = this.destination;
    const room = destination ? this.building.roomOf(destination) : undefined;
    const door = room && room.doors && room.doors[0];
    if (!route || !door) return null;
    let dir: number | null = this.tracker.travelDirection;
    for (const leg of route.legs) if (leg.kind === 'walk' && leg.length > 0.5) dir = leg.dir;
    if (dir === null) return null;
    const vx = door.x - destination.x;
    const vy = door.y - destination.y;
    const across = Math.cos(dir) * vy - Math.sin(dir) * vx; // > 0: to the right on a y-down map
    const along = Math.cos(dir) * vx + Math.sin(dir) * vy;
    if (Math.hypot(vx, vy) < 1e-6) return null;
    if (Math.abs(along) > Math.abs(across)) return along > 0 ? 'ahead' : null;
    return across > 0 ? 'right' : 'left';
  }

  private buildSnapshot(): NavSnapshot {
    const tracker = this.tracker;
    const pos = tracker.position;
    const route = this.route;
    const remaining = this.status === 'arrived' ? 0 : route ? route.length : 0;

    let nextMarker: NavNode | null = null;
    if (route) {
      for (const id of route.nodeIds) {
        const n = this.building.node(id)!;
        const standingOnIt = pos !== null && pos.to === null && pos.from === id;
        if (n.qr && !standingOnIt) {
          nextMarker = n;
          break;
        }
      }
    }

    return {
      status: this.status,
      destination: this.destination,
      position: pos,
      heading: tracker.heading,
      headingCalibrated: tracker.headingCalibrated,
      accuracy: tracker.accuracy,
      route,
      maneuvers: this.maneuvers,
      guidance: this.status === 'arrived' ? null : this.guidance,
      remaining,
      etaSeconds: remaining / WALKING_SPEED,
      wrongWay: this.wrongWaySteps >= 3,
      needsRecalibration: tracker.hasFix && tracker.accuracy > RECALIBRATE_ABOVE && this.status === 'navigating',
      floorChange: this.status === 'arrived' ? null : tracker.awaitingFloorChange,
      nextMarker,
      lastFix: this.lastFix,
      rerouteCount: this.rerouteCount,
      arrivalConfirmed: this.arrivalConfirmed,
      sinceFix: tracker.distanceSinceFix,
      destinationSide: this.destinationSide(route),
      stepFree: !!this.routeOptions.avoidStairs,
      version: ++this.version,
    };
  }
}
