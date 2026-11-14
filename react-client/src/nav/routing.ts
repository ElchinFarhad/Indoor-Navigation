/**
 * Shortest path search (Dijkstra) over the building graph.
 *
 * Compared with the first version this
 *  - uses adjacency lists and a binary heap instead of an N x N matrix,
 *  - can start from any point along a corridor, not only from a node, which is
 *    what makes continuous re-routing possible while the user walks,
 *  - understands floors (stairs / elevator edges),
 *  - returns `null` instead of throwing when there is no path.
 */
import { Building, EdgeKind, HalfEdge } from './building';
import { lerp } from './geometry';

export interface RoutePoint {
  x: number;
  y: number;
  floor: number;
  /** Graph node at this point, `null` for a start position in the middle of a corridor. */
  nodeId: number | null;
}

export interface RouteLeg {
  from: RoutePoint;
  to: RoutePoint;
  /** metres */
  length: number;
  /** Map direction of travel, radians. */
  dir: number;
  kind: EdgeKind;
  /** Distance from the start of the route to the start of this leg, metres. */
  startsAt: number;
}

export interface Route {
  destId: number;
  /** Graph nodes passed, in order. Does not include a mid-corridor start. */
  nodeIds: number[];
  points: RoutePoint[];
  legs: RouteLeg[];
  /** Total walking distance in metres. */
  length: number;
  cost: number;
}

export interface RouteOptions {
  /** Step-free route: never use stairs (lifts only between floors). */
  avoidStairs?: boolean;
}

/** Where a route starts: at a node, or `t` metres along the corridor from -> to. */
export type RouteStart = { nodeId: number } | { from: number; to: number; t: number };

class MinHeap {
  private items: Array<{ id: number; key: number }> = [];

  get size() {
    return this.items.length;
  }

  push(id: number, key: number) {
    const a = this.items;
    a.push({ id, key });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].key <= a[i].key) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }

  pop(): { id: number; key: number } | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Dijkstra from one or more seed nodes (each with an initial cost).
 * Returns the node sequence to `destId` and its total cost, or `null`.
 */
function dijkstra(
  building: Building,
  seeds: Array<{ id: number; cost: number }>,
  destId: number,
  options?: RouteOptions
): { nodeIds: number[]; cost: number } | null {
  const avoidStairs = !!(options && options.avoidStairs);
  if (!building.node(destId)) return null;
  const dist = new Map<number, number>();
  const parent = new Map<number, number>();
  const heap = new MinHeap();
  for (const s of seeds) {
    if (!building.node(s.id)) continue;
    if (s.cost < (dist.has(s.id) ? dist.get(s.id)! : Infinity)) {
      dist.set(s.id, s.cost);
      heap.push(s.id, s.cost);
    }
  }
  const done = new Set<number>();
  while (heap.size > 0) {
    const { id, key } = heap.pop()!;
    if (done.has(id)) continue;
    done.add(id);
    if (id === destId) break;
    for (const e of building.edgesFrom(id)) {
      if (done.has(e.to) || (avoidStairs && e.kind === 'stairs')) continue;
      const next = key + e.cost;
      if (next < (dist.has(e.to) ? dist.get(e.to)! : Infinity)) {
        dist.set(e.to, next);
        parent.set(e.to, id);
        heap.push(e.to, next);
      }
    }
  }
  if (!done.has(destId)) return null;
  const nodeIds = [destId];
  let cur = destId;
  while (parent.has(cur)) {
    cur = parent.get(cur)!;
    nodeIds.push(cur);
  }
  nodeIds.reverse();
  return { nodeIds, cost: dist.get(destId)! };
}

/** Node sequence of the cheapest path between two nodes, or `null` if they are not connected. */
export function shortestPath(
  building: Building,
  sourceId: number,
  destId: number,
  options?: RouteOptions
): { nodeIds: number[]; cost: number } | null {
  if (!building.node(sourceId)) return null;
  return dijkstra(building, [{ id: sourceId, cost: 0 }], destId, options);
}

/** Walking distance in metres along the cheapest path between two nodes. */
export function walkingDistance(building: Building, sourceId: number, destId: number): number | null {
  const path = shortestPath(building, sourceId, destId);
  if (!path) return null;
  let total = 0;
  for (let i = 0; i + 1 < path.nodeIds.length; i++) {
    total += building.edge(path.nodeIds[i], path.nodeIds[i + 1])!.length;
  }
  return total;
}

function pointOfNode(building: Building, id: number): RoutePoint {
  const n = building.node(id)!;
  return { x: n.x, y: n.y, floor: n.floor, nodeId: n.id };
}

function buildRoute(
  building: Building,
  destId: number,
  nodeIds: number[],
  cost: number,
  lead: { point: RoutePoint; edge: HalfEdge; remaining: number } | null
): Route {
  const points: RoutePoint[] = [];
  const legs: RouteLeg[] = [];
  let total = 0;
  const addLeg = (from: RoutePoint, to: RoutePoint, length: number, dir: number, kind: EdgeKind) => {
    legs.push({ from, to, length, dir, kind, startsAt: total });
    total += length;
  };

  if (lead) {
    points.push(lead.point);
    const first = pointOfNode(building, nodeIds[0]);
    addLeg(lead.point, first, lead.remaining, lead.edge.dir, lead.edge.kind);
  }
  for (let i = 0; i < nodeIds.length; i++) {
    const p = pointOfNode(building, nodeIds[i]);
    if (i > 0) {
      const e = building.edge(nodeIds[i - 1], nodeIds[i])!;
      addLeg(points[points.length - 1], p, e.length, e.dir, e.kind);
    }
    points.push(p);
  }
  return { destId, nodeIds, points, legs, length: total, cost };
}

/** Computes the route from a start position to a destination node. */
export function findRoute(building: Building, start: RouteStart, destId: number, options?: RouteOptions): Route | null {
  if ('nodeId' in start) {
    const path = shortestPath(building, start.nodeId, destId, options);
    return path ? buildRoute(building, destId, path.nodeIds, path.cost, null) : null;
  }

  const edge = building.edge(start.from, start.to);
  if (!edge) return findRoute(building, { nodeId: start.from }, destId, options);
  const EPS = 0.05;
  if (start.t <= EPS) return findRoute(building, { nodeId: start.from }, destId, options);
  if (start.t >= edge.length - EPS) return findRoute(building, { nodeId: start.to }, destId, options);

  // Somewhere along a corridor: either end of it may be the better way out.
  const fraction = start.t / edge.length;
  const path = dijkstra(
    building,
    [
      { id: start.from, cost: edge.cost * fraction },
      { id: start.to, cost: edge.cost * (1 - fraction) },
    ],
    destId,
    options
  );
  if (!path) return null;
  const a = building.node(start.from)!;
  const b = building.node(start.to)!;
  const point: RoutePoint = {
    x: lerp(a.x, b.x, fraction),
    y: lerp(a.y, b.y, fraction),
    floor: a.floor,
    nodeId: null,
  };
  const viaTo = path.nodeIds[0] === start.to;
  const lead = viaTo
    ? { point, edge, remaining: edge.length - start.t }
    : { point, edge: building.edge(start.to, start.from)!, remaining: start.t };
  return buildRoute(building, destId, path.nodeIds, path.cost, lead);
}

/** Position `s` metres along a route (clamped to its ends). */
export function pointAlongRoute(route: Route, s: number): RoutePoint & { legIndex: number } {
  if (route.legs.length === 0) return { ...route.points[0], legIndex: 0 };
  for (let i = 0; i < route.legs.length; i++) {
    const leg = route.legs[i];
    if (s <= leg.startsAt + leg.length || i === route.legs.length - 1) {
      const f = leg.length > 0 ? Math.min(1, Math.max(0, (s - leg.startsAt) / leg.length)) : 1;
      if (leg.kind !== 'walk') {
        // No meaningful interpolation between floors: stay at the nearer end.
        return { ...(f < 1 ? leg.from : leg.to), nodeId: null, legIndex: i };
      }
      return {
        x: lerp(leg.from.x, leg.to.x, f),
        y: lerp(leg.from.y, leg.to.y, f),
        floor: leg.from.floor,
        nodeId: null,
        legIndex: i,
      };
    }
  }
  return { ...route.points[route.points.length - 1], legIndex: route.legs.length - 1 };
}
