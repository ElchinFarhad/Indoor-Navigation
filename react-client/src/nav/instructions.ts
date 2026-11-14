/**
 * Turns a route (a polyline through the graph) into turn-by-turn guidance.
 */
import { Building, NavNode } from './building';
import { angleDiff, DEG, formatDistance } from './geometry';
import { Route } from './routing';

export type ManeuverType =
  | 'straight'
  | 'slight-left'
  | 'left'
  | 'sharp-left'
  | 'slight-right'
  | 'right'
  | 'sharp-right'
  | 'uturn'
  | 'stairs-up'
  | 'stairs-down'
  | 'elevator-up'
  | 'elevator-down'
  | 'arrive';

export interface Maneuver {
  type: ManeuverType;
  /** Distance from the start of the route at which the maneuver happens, metres. */
  at: number;
  /** Index into `route.points` of the point where it happens. */
  pointIndex: number;
  /** Short imperative text: "Turn left". */
  text: string;
  /** Extra context: "at marker B", "to First floor". */
  detail?: string;
  /** Signed change of direction in radians (right is positive), for turns. */
  angle?: number;
  /** Target floor for stairs / elevator maneuvers. */
  toFloor?: number;
  /** Graph node where the maneuver happens (null for one at a mid-corridor start). */
  nodeId?: number | null;
}

const STRAIGHT_BELOW = 25 * DEG;
const SLIGHT_BELOW = 55 * DEG;
const SHARP_ABOVE = 125 * DEG;
const UTURN_ABOVE = 160 * DEG;

/** Classifies a signed change of direction (radians, right positive). */
export function classifyTurn(angle: number): ManeuverType {
  const a = Math.abs(angle);
  if (a < STRAIGHT_BELOW) return 'straight';
  if (a >= UTURN_ABOVE) return 'uturn';
  const side = angle > 0 ? 'right' : 'left';
  if (a < SLIGHT_BELOW) return (`slight-${side}` as ManeuverType);
  if (a > SHARP_ABOVE) return (`sharp-${side}` as ManeuverType);
  return side;
}

/** "at Stairs A", "at the lobby", "at marker B": where a maneuver happens, in words. */
export function landmark(building: Building, node: NavNode): string {
  if (!node.label) return `at marker ${node.name}`;
  if (node.type === 'node') return `at the ${node.label.toLowerCase()}`;
  if (node.type === 'elevator') return 'at the lift';
  if (node.type === 'stairs') return `at ${node.label}`;
  return `by ${building.displayName(node)}`;
}

const TURN_TEXT: { [k: string]: string } = {
  straight: 'Continue straight',
  'slight-left': 'Keep left',
  left: 'Turn left',
  'sharp-left': 'Turn sharp left',
  'slight-right': 'Keep right',
  right: 'Turn right',
  'sharp-right': 'Turn sharp right',
  uturn: 'Turn around',
};

export function turnText(type: ManeuverType): string {
  return TURN_TEXT[type] || '';
}

/**
 * Lists the maneuvers of a route, in order. The last one is always `arrive`.
 *
 * `incomingDir` is the direction the user was already walking in when the
 * route starts (if known). It lets the first node of the route produce a turn
 * instruction too, which matters when the user is standing right on a junction.
 */
export function buildManeuvers(building: Building, route: Route, incomingDir?: number | null): Maneuver[] {
  const out: Maneuver[] = [];
  const legs = route.legs;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const node = leg.from.nodeId !== null ? building.node(leg.from.nodeId) : undefined;

    if (leg.kind !== 'walk') {
      const up = leg.to.floor > leg.from.floor;
      const floor = building.floor(leg.to.floor);
      const via = node && node.label ? ` (${node.label})` : '';
      const type = (`${leg.kind === 'elevator' ? 'elevator' : 'stairs'}-${up ? 'up' : 'down'}`) as ManeuverType;
      out.push({
        type,
        at: leg.startsAt,
        pointIndex: i,
        text: leg.kind === 'elevator' ? `Take the lift ${up ? 'up' : 'down'}` : `Take the stairs ${up ? 'up' : 'down'}`,
        detail: `to ${floor ? floor.name : `floor ${leg.to.floor}`}${via}`,
        nodeId: node ? node.id : null,
        toFloor: leg.to.floor,
      });
      continue;
    }

    // Direction change at the start of this leg.
    let previousDir: number | null | undefined = null;
    if (i > 0) previousDir = legs[i - 1].kind === 'walk' ? legs[i - 1].dir : null;
    else previousDir = incomingDir;
    if (previousDir === null || previousDir === undefined) continue;

    const angle = angleDiff(leg.dir, previousDir);
    const type = classifyTurn(angle);
    if (type === 'straight') continue;
    out.push({
      type,
      at: leg.startsAt,
      pointIndex: i,
      text: turnText(type),
      detail: node && i > 0 ? landmark(building, node) : undefined,
      angle,
      nodeId: node ? node.id : null,
    });
  }

  const dest = building.node(route.destId);
  out.push({
    type: 'arrive',
    at: route.length,
    pointIndex: route.points.length - 1,
    text: dest ? `Arrive at ${building.displayName(dest)}` : 'Arrive at your destination',
    nodeId: route.destId,
  });
  return out;
}

export interface Guidance {
  /** The maneuver to announce now. */
  maneuver: Maneuver;
  /** Distance to it in metres. */
  distance: number;
  /** One line for the banner: "In 12 m, turn left". */
  headline: string;
  /** The maneuver after it, if it follows closely enough to be worth showing. */
  then?: Maneuver;
}

/** Guidance for a user who is `s` metres into the route. */
export function guidanceAt(maneuvers: Maneuver[], s: number): Guidance | null {
  if (maneuvers.length === 0) return null;
  let index = maneuvers.findIndex((m) => m.at >= s - 0.5);
  if (index < 0) index = maneuvers.length - 1;
  const maneuver = maneuvers[index];
  const dist = Math.max(0, maneuver.at - s);
  const next = maneuvers[index + 1];
  const then = next && next.at - maneuver.at < 12 ? next : undefined;

  let headline: string;
  if (dist < 1.5) {
    headline = maneuver.text;
  } else if (maneuver.type === 'arrive') {
    headline = `Continue ${formatDistance(dist)}`;
  } else {
    headline = `In ${formatDistance(dist)}, ${lowerFirst(maneuver.text)}`;
  }
  return { maneuver, distance: dist, headline, then };
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
