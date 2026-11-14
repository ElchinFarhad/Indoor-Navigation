/**
 * Position tracking between QR markers.
 *
 * A QR marker gives an exact position (and, through its pose, the direction
 * the user is facing). Between markers the tracker keeps the estimate alive
 * with pedestrian dead reckoning: every detected step moves the user by one
 * step length in the direction the phone is pointing.
 *
 * Raw dead reckoning drifts quickly, so it is constrained by the map
 * ("map matching"): the user is assumed to be somewhere on the corridor graph.
 * A step along the current corridor advances along it; steps in the direction
 * of another corridor close to a junction are understood as "the user took
 * that turn", which also snaps the estimate onto the junction and removes the
 * distance error accumulated so far. Walking along a corridor slowly pulls the
 * heading calibration towards the corridor's direction, which cancels gyro
 * drift. The estimate carries an accuracy radius that grows with every step
 * and collapses again at the next marker.
 */
import { Building, HalfEdge, NavNode } from './building';
import { angleDiff, clamp, DEG, distance, lerp, wrapAngle } from './geometry';
import { Route, walkingDistance } from './routing';

export interface MarkerFix {
  nodeId: number;
  /** Direction the user is facing on the map (from the marker's pose), if known. */
  heading?: number | null;
  /** User position relative to the marker, in map units, if known. */
  offset?: { x: number; y: number } | null;
  /** Milliseconds. */
  time?: number;
}

export interface FixResult {
  node: NavNode;
  /** How far the estimate was from the marker, metres (`null` for the first fix or another floor). */
  correction: number | null;
  /** True if this marker differs from the previous fix. */
  newMarker: boolean;
}

export interface TrackedPosition {
  x: number;
  y: number;
  floor: number;
  /** The corridor the user is on: `t` metres from `from` towards `to`. `to` is null when standing at a node. */
  from: number;
  to: number | null;
  t: number;
}

export interface PendingFloorChange {
  from: number;
  to: number;
  toFloor: number;
  kind: 'stairs' | 'elevator';
}

const ALIGNED = 60 * DEG; // heading within this of a corridor = walking along it
const REVERSED = 120 * DEG; // beyond this = walking along it the other way
const TURN_ALIGNED = 35 * DEG; // heading within this of another corridor = candidate turn
const TURN_MARGIN = 20 * DEG; // ...and it must fit that much better than the current one
const ROUTE_BONUS = 15 * DEG; // preference for the corridor the route continues on
const FLOOR_CHANGE_REACH = 1.0; // metres from the stairs at which the user is taken to be on them

export class PositionTracker {
  readonly building: Building;

  /** Current step length in metres (adapts between markers). */
  stepLength: number;

  private hasPosition = false;
  private from = -1;
  private to: number | null = null;
  private t = 0;

  private sensorHeading: number | null = null;
  private headingOffset: number | null = null;
  /** Heading known only from a marker, used until an orientation sensor reports. */
  private fallbackHeading: number | null = null;
  private headingAssumed = false;

  private accuracyM = Infinity;
  private steps = 0;
  private walked = 0;
  private lateralSteps = 0;
  private alignedSteps = 0;
  private lastFixNode: number | null = null;
  private lastFixTime = 0;
  private lastCorrectionM: number | null = null;
  private pendingTurn: { node: number; to: number; count: number; dist: number } | null = null;
  private pendingFloor: PendingFloorChange | null = null;
  private floorChangeDeclinedAt: number | null = null;
  private routeNext = new Map<number, number>();
  private lastTravelDir: number | null = null;

  constructor(building: Building, options: { stepLength?: number } = {}) {
    this.building = building;
    this.stepLength = options.stepLength || 0.7;
  }

  /* ------------------------------------------------------------------ state */

  get hasFix(): boolean {
    return this.hasPosition;
  }

  /** Estimated accuracy radius in metres. */
  get accuracy(): number {
    return this.accuracyM;
  }

  get stepsSinceFix(): number {
    return this.steps;
  }

  get distanceSinceFix(): number {
    return this.walked;
  }

  get lastFixNodeId(): number | null {
    return this.lastFixNode;
  }

  get lastFixAt(): number {
    return this.lastFixTime;
  }

  /** Position error found at the last marker, metres. */
  get lastCorrection(): number | null {
    return this.lastCorrectionM;
  }

  /** Stairs / elevator the user is expected to be taking right now. */
  get awaitingFloorChange(): PendingFloorChange | null {
    return this.pendingFloor;
  }

  /** True when the heading comes from a marker or sensor calibration rather than an assumption. */
  get headingCalibrated(): boolean {
    return this.headingOffset !== null && !this.headingAssumed;
  }

  /** Direction the user is facing on the map, radians, or `null` if unknown. */
  get heading(): number | null {
    if (this.sensorHeading !== null && this.headingOffset !== null) {
      return wrapAngle(this.sensorHeading + this.headingOffset);
    }
    return this.fallbackHeading;
  }

  /** Offset that turns the orientation sensor's heading into a map heading, or `null`. */
  get calibration(): number | null {
    return this.headingOffset;
  }

  /** Direction of the corridor the user last walked along. */
  get travelDirection(): number | null {
    return this.lastTravelDir;
  }

  get position(): TrackedPosition | null {
    if (!this.hasPosition) return null;
    const a = this.building.node(this.from)!;
    if (this.to === null) return { x: a.x, y: a.y, floor: a.floor, from: this.from, to: null, t: 0 };
    const b = this.building.node(this.to)!;
    const e = this.building.edge(this.from, this.to)!;
    const f = e.length > 0 ? clamp(this.t / e.length, 0, 1) : 0;
    return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), floor: a.floor, from: this.from, to: this.to, t: this.t };
  }

  /* ----------------------------------------------------------------- inputs */

  /** Tells the tracker which way the user is supposed to go, so ambiguous steps follow the route. */
  setRoute(route: Route | null) {
    this.routeNext.clear();
    if (route) {
      for (let i = 0; i + 1 < route.nodeIds.length; i++) {
        this.routeNext.set(route.nodeIds[i], route.nodeIds[i + 1]);
      }
    }
    this.checkFloorChange();
  }

  /** Heading reported by the orientation sensor, in its own (uncalibrated) frame. */
  onSensorHeading(heading: number) {
    this.sensorHeading = heading;
    if (this.headingOffset === null && this.fallbackHeading !== null) {
      // First sensor sample after a marker told us the heading: calibrate now.
      this.headingOffset = wrapAngle(this.fallbackHeading - heading);
      this.headingAssumed = false;
    }
  }

  /** The user is at a QR marker. */
  applyFix(fix: MarkerFix): FixResult | null {
    const node = this.building.node(fix.nodeId);
    if (!node) return null;

    const before = this.position;
    const correction =
      before && before.floor === node.floor ? distance(before, node) * this.building.metersPerUnit : null;
    const newMarker = this.lastFixNode !== node.id;

    // Learn the step length from the stretch between two different markers.
    if (newMarker && this.lastFixNode !== null && this.steps >= 8 && this.walked > 3) {
      const truth = walkingDistance(this.building, this.lastFixNode, node.id);
      const last = this.building.node(this.lastFixNode);
      if (truth !== null && truth > 3 && last && last.floor === node.floor) {
        const ratio = clamp(truth / this.walked, 0.75, 1.3);
        this.stepLength = clamp(this.stepLength * (1 + 0.5 * (ratio - 1)), 0.45, 0.95);
      }
    }

    this.hasPosition = true;
    this.from = node.id;
    this.to = null;
    this.t = 0;
    this.pendingTurn = null;
    this.pendingFloor = null;
    this.lateralSteps = 0;
    this.lastCorrectionM = correction;
    this.steps = 0;
    this.walked = 0;
    this.floorChangeDeclinedAt = null;
    this.lastFixNode = node.id;
    this.lastFixTime = fix.time !== undefined ? fix.time : Date.now();

    if (fix.heading !== undefined && fix.heading !== null) {
      this.fallbackHeading = fix.heading;
      if (this.sensorHeading !== null) {
        this.headingOffset = wrapAngle(fix.heading - this.sensorHeading);
        this.headingAssumed = false;
      }
      this.accuracyM = 0.5;
    } else {
      this.accuracyM = 1.0;
    }

    // The camera is usually a little away from the marker: start on the
    // corridor that leads towards where the user actually stands.
    if (fix.offset && !this.floorChangeAt(node.id)) {
      const mpu = this.building.metersPerUnit;
      const ox = fix.offset.x * mpu;
      const oy = fix.offset.y * mpu;
      const reach = Math.hypot(ox, oy);
      if (reach > 0.4 && reach < 4) {
        let best: HalfEdge | null = null;
        let bestAlong = 0.4;
        for (const e of this.building.edgesFrom(node.id)) {
          if (e.kind !== 'walk') continue;
          const along = ox * Math.cos(e.dir) + oy * Math.sin(e.dir);
          const across = Math.abs(-ox * Math.sin(e.dir) + oy * Math.cos(e.dir));
          if (along > bestAlong && across < 1.5) {
            best = e;
            bestAlong = along;
          }
        }
        if (best) {
          this.to = best.to;
          this.t = Math.min(bestAlong, best.length);
        }
        this.accuracyM = Math.max(this.accuracyM, 0.3 * reach);
      }
    }

    this.checkFloorChange();
    return { node, correction, newMarker };
  }

  /** Sets the position without a marker (start point chosen by hand). */
  setManualPosition(nodeId: number): boolean {
    const result = this.applyFix({ nodeId });
    if (result) this.accuracyM = 2;
    return result !== null;
  }

  /** The user says they reached the other end of the stairs / elevator. */
  confirmFloorChange(): boolean {
    const p = this.pendingFloor;
    if (!p) return false;
    this.from = p.to;
    this.to = null;
    this.t = 0;
    this.pendingFloor = null;
    this.pendingTurn = null;
    this.accuracyM = 2;
    this.steps = 0;
    this.walked = 0;
    this.lastFixNode = null; // the stretch across floors is no step length reference
    this.checkFloorChange();
    return true;
  }

  /** The user is not taking the stairs / elevator after all: keep tracking on this floor. */
  cancelFloorChange() {
    if (!this.pendingFloor) return;
    this.floorChangeDeclinedAt = this.pendingFloor.from;
    this.pendingFloor = null;
  }

  /**
   * One step was detected.
   * @param lengthFactor step length of this step relative to the user's average (1 = average)
   */
  onStep(lengthFactor = 1) {
    if (!this.hasPosition) return;
    this.steps++;
    if (this.pendingFloor) return; // on the stairs: horizontal position does not change

    const L = this.stepLength * clamp(lengthFactor, 0.6, 1.4);
    const h = this.heading;

    if (h === null || this.sensorHeading === null || this.headingOffset === null) {
      // No usable heading: assume the user follows the route, as the original
      // marker-to-marker navigation did, and say so through the accuracy.
      this.followRoute(L);
      if (this.sensorHeading !== null && this.to !== null && this.steps >= 2) {
        // Bootstrap the calibration from the walking direction.
        const e = this.building.edge(this.from, this.to)!;
        this.headingOffset = wrapAngle(e.dir - this.sensorHeading);
        this.headingAssumed = true;
      }
      return;
    }

    if (this.to === null) {
      const start = this.bestEdgeFrom(this.from, h, ALIGNED, null);
      if (!start) {
        this.lateral(L);
        return;
      }
      this.to = start.to;
      this.t = 0;
    }

    let e = this.building.edge(this.from, this.to)!;
    let diff = angleDiff(h, e.dir);
    if (Math.abs(diff) > REVERSED) {
      // Walking back the way they came: flip the corridor so "forward" is ahead.
      const back = this.building.edge(this.to, this.from)!;
      this.t = e.length - this.t;
      this.from = e.to;
      this.to = e.from;
      e = back;
      diff = angleDiff(h, e.dir);
    }
    const off = Math.abs(diff);

    const turn = this.findTurn(h, e, off);
    if (turn && (off > ALIGNED || off - turn.angle >= TURN_MARGIN)) {
      const along = L * Math.cos(turn.angle);
      if (this.pendingTurn && this.pendingTurn.node === turn.edge.from && this.pendingTurn.to === turn.edge.to) {
        this.pendingTurn.count++;
        this.pendingTurn.dist += along;
      } else {
        this.pendingTurn = { node: turn.edge.from, to: turn.edge.to, count: 1, dist: along };
      }
      if (this.pendingTurn.count >= 2) {
        // Two steps in a row along the other corridor: the user turned at that junction.
        this.from = turn.edge.from;
        this.to = turn.edge.to;
        this.t = Math.min(this.pendingTurn.dist, turn.edge.length);
        this.walked += this.pendingTurn.dist;
        this.accuracyM = Math.max(1, this.accuracyM * 0.5);
        this.pendingTurn = null;
        this.lateralSteps = 0;
        this.alignedSteps = 0;
        this.lastTravelDir = turn.edge.dir;
        this.checkFloorChange();
      }
      return;
    }
    this.pendingTurn = null;

    if (off <= ALIGNED) {
      this.lateralSteps = 0;
      this.lastTravelDir = e.dir;
      this.advance(L * Math.cos(diff), h);
      // Corridors are straight: use them to cancel slow heading drift.
      if (off <= 20 * DEG && this.headingOffset !== null) {
        this.alignedSteps++;
        if (this.alignedSteps >= 3) this.headingOffset = wrapAngle(this.headingOffset - 0.08 * diff);
      } else {
        this.alignedSteps = 0;
      }
    } else {
      this.lateral(L);
    }
  }

  /* -------------------------------------------------------------- internals */

  private lateral(L: number) {
    // A step that fits no corridor: probably looking around. Do not move, but trust the estimate less.
    this.lateralSteps++;
    this.alignedSteps = 0;
    this.accuracyM += 0.35 * L;
  }

  private advance(dist: number, heading: number) {
    this.t += dist;
    this.walked += dist;
    this.accuracyM += 0.08 * dist;
    for (let guard = 0; guard < 8 && this.to !== null; guard++) {
      const e = this.building.edge(this.from, this.to)!;
      if (this.t <= e.length) break;
      const overflow = this.t - e.length;
      const arrivedAt = this.to;
      const next = this.bestEdgeFrom(arrivedAt, heading, 50 * DEG, this.from);
      this.from = arrivedAt;
      if (next && !this.floorChangeAt(arrivedAt)) {
        this.to = next.to;
        this.t = overflow;
        this.lastTravelDir = next.dir;
      } else {
        // Nothing continues in this direction: wait at the node for the user to turn.
        this.to = null;
        this.t = 0;
      }
    }
    this.checkFloorChange();
  }

  private followRoute(L: number) {
    this.accuracyM += 0.3 * L;
    if (this.to === null) {
      const next = this.routeNext.get(this.from);
      const e = next !== undefined ? this.building.edge(this.from, next) : undefined;
      if (!e || e.kind !== 'walk') return;
      this.to = e.to;
      this.t = 0;
    }
    const e = this.building.edge(this.from, this.to)!;
    this.lastTravelDir = e.dir;
    this.t += L;
    this.walked += L;
    if (this.t >= e.length) {
      this.from = e.to;
      this.to = null;
      this.t = 0;
      this.checkFloorChange();
    }
  }

  /** The route's stairs / elevator edge leaving `nodeId`, if any. */
  private floorChangeAt(nodeId: number): HalfEdge | null {
    if (nodeId === this.floorChangeDeclinedAt) return null;
    const next = this.routeNext.get(nodeId);
    if (next === undefined) return null;
    const e = this.building.edge(nodeId, next);
    return e && e.kind !== 'walk' ? e : null;
  }

  private checkFloorChange() {
    if (!this.hasPosition) return;
    if (this.to !== null) {
      // Dead reckoning rarely ends exactly on a node: within a metre of the
      // stairs the route takes, the user is considered to have reached them.
      const e = this.building.edge(this.from, this.to)!;
      if (e.length - this.t <= FLOOR_CHANGE_REACH && this.floorChangeAt(this.to)) {
        this.from = this.to;
      } else if (!(this.t <= FLOOR_CHANGE_REACH && this.floorChangeAt(this.from))) {
        this.pendingFloor = null;
        if (this.to !== this.floorChangeDeclinedAt && this.from !== this.floorChangeDeclinedAt) {
          this.floorChangeDeclinedAt = null;
        }
        return;
      }
      this.to = null;
      this.t = 0;
    }
    const e = this.floorChangeAt(this.from);
    this.pendingFloor = e
      ? { from: e.from, to: e.to, toFloor: this.building.node(e.to)!.floor, kind: e.kind === 'elevator' ? 'elevator' : 'stairs' }
      : null;
  }

  /** Best walkable corridor leaving `nodeId` for somebody facing `heading`. */
  private bestEdgeFrom(nodeId: number, heading: number, maxAngle: number, exclude: number | null): HalfEdge | null {
    let best: HalfEdge | null = null;
    let bestScore = Infinity;
    const routeTo = this.routeNext.get(nodeId);
    for (const e of this.building.edgesFrom(nodeId)) {
      if (e.kind !== 'walk' || e.to === exclude) continue;
      const a = Math.abs(angleDiff(heading, e.dir));
      if (a > maxAngle) continue;
      const score = a - (e.to === routeTo ? ROUTE_BONUS : 0);
      if (score < bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * Looks for a corridor at a nearby junction that explains the heading better
   * than the corridor the user is on.
   */
  private findTurn(heading: number, current: HalfEdge, currentOff: number): { edge: HalfEdge; angle: number } | null {
    // The further the user walked since the last marker, the further from the
    // junction (on the map) the real turn may happen.
    const reach = clamp(1 + this.accuracyM * 1.5, 2, 7);
    const candidates: Array<{ node: number; gap: number; other: number }> = [];
    if (current.length - this.t <= reach) candidates.push({ node: current.to, gap: current.length - this.t, other: current.from });
    if (this.t <= reach) candidates.push({ node: current.from, gap: this.t, other: current.to });

    let best: { edge: HalfEdge; angle: number } | null = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      const routeTo = this.routeNext.get(c.node);
      for (const e of this.building.edgesFrom(c.node)) {
        if (e.kind !== 'walk' || e.to === c.other) continue;
        const angle = Math.abs(angleDiff(heading, e.dir));
        if (angle > TURN_ALIGNED) continue;
        const score = angle - (e.to === routeTo ? ROUTE_BONUS : 0) + c.gap * 3 * DEG;
        if (score < bestScore) {
          best = { edge: e, angle };
          bestScore = score;
        }
      }
    }
    if (best && currentOff - best.angle < TURN_MARGIN && currentOff <= ALIGNED) return null;
    return best;
  }
}
