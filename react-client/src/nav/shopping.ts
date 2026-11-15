/**
 * Shopping trips: from a list of products to an ordered list of stops.
 *
 * Products that share a shelf section share a stop. The order of the stops is
 * the one with the shortest total walk from where the shopper is, through
 * every stop, to the checkout: found exactly (dynamic programming over
 * subsets) for up to twelve stops, and with nearest-neighbour plus 2-opt
 * improvement beyond that. Distances are walking distances through the aisles,
 * not straight lines.
 */
import { Building, Product } from './building';
import { walkingDistance } from './routing';

export interface Stop {
  nodeId: number;
  /** What to pick up here (empty for the checkout). */
  products: Product[];
  /** True for the final stop at the checkout. */
  checkout: boolean;
}

export interface Trip {
  stops: Stop[];
  /** Total walking distance in metres, from the start through all stops. */
  length: number;
  /** Product ids that are not in the catalogue. */
  unknown: string[];
}

const EXACT_LIMIT = 12;

/** The node where shopping ends, if the store has checkouts. */
export function checkoutNode(building: Building): number | null {
  const node = building.nodes.find((n) => n.kind === 'checkout');
  return node ? node.id : null;
}

/** The node where shopping normally starts. */
export function entranceNode(building: Building): number | null {
  const node = building.nodes.find((n) => n.kind === 'lobby');
  return node ? node.id : null;
}

function distanceTable(building: Building, ids: number[]): number[][] {
  return ids.map((a) =>
    ids.map((b) => {
      if (a === b) return 0;
      const d = walkingDistance(building, a, b);
      return d === null ? 1e9 : d;
    })
  );
}

/** Best order of points 1..n-2 on a path from point 0 to point n-1, exactly. */
function exactOrder(d: number[][]): number[] {
  const n = d.length;
  const m = n - 2; // points to order
  if (m <= 0) return [];
  const full = 1 << m;
  const cost: number[][] = [];
  const from: number[][] = [];
  for (let mask = 0; mask < full; mask++) {
    cost.push(new Array(m).fill(Infinity));
    from.push(new Array(m).fill(-1));
  }
  for (let i = 0; i < m; i++) cost[1 << i][i] = d[0][i + 1];
  for (let mask = 1; mask < full; mask++) {
    for (let last = 0; last < m; last++) {
      const c = cost[mask][last];
      if (!(mask & (1 << last)) || c === Infinity) continue;
      for (let next = 0; next < m; next++) {
        if (mask & (1 << next)) continue;
        const to = mask | (1 << next);
        const value = c + d[last + 1][next + 1];
        if (value < cost[to][next]) {
          cost[to][next] = value;
          from[to][next] = last;
        }
      }
    }
  }
  let best = -1;
  let bestCost = Infinity;
  for (let last = 0; last < m; last++) {
    const value = cost[full - 1][last] + d[last + 1][n - 1];
    if (value < bestCost) {
      bestCost = value;
      best = last;
    }
  }
  const order: number[] = [];
  let mask = full - 1;
  while (best >= 0) {
    order.push(best + 1);
    const previous = from[mask][best];
    mask &= ~(1 << best);
    best = previous;
  }
  return order.reverse();
}

/** Nearest neighbour, then 2-opt, for lists too long to solve exactly. */
function heuristicOrder(d: number[][]): number[] {
  const n = d.length;
  const left: number[] = [];
  for (let i = 1; i < n - 1; i++) left.push(i);
  const order: number[] = [];
  let at = 0;
  while (left.length > 0) {
    let pick = 0;
    for (let i = 1; i < left.length; i++) if (d[at][left[i]] < d[at][left[pick]]) pick = i;
    at = left.splice(pick, 1)[0];
    order.push(at);
  }
  const length = (o: number[]) => {
    let total = d[0][o[0]];
    for (let i = 0; i + 1 < o.length; i++) total += d[o[i]][o[i + 1]];
    return total + d[o[o.length - 1]][n - 1];
  };
  let improved = order.length > 2;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
        if (length(candidate) < length(order) - 1e-9) {
          order.splice(0, order.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return order;
}

/**
 * Plans a shopping trip.
 * @param productIds what is on the list
 * @param startNodeId where the shopper is (default: the entrance)
 */
export function planTrip(building: Building, productIds: string[], startNodeId?: number | null): Trip {
  const unknown: string[] = [];
  const byNode = new Map<number, Product[]>();
  const seen = new Set<string>();
  for (const id of productIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const product = building.product(id);
    if (!product) {
      unknown.push(id);
      continue;
    }
    const list = byNode.get(product.nodeId) || [];
    list.push(product);
    byNode.set(product.nodeId, list);
  }

  const start = startNodeId !== undefined && startNodeId !== null && building.node(startNodeId) ? startNodeId : entranceNode(building);
  const end = checkoutNode(building);
  const stopNodes = Array.from(byNode.keys());
  if (stopNodes.length === 0) return { stops: [], length: 0, unknown };

  // Points of the tour: start, the stops, the end. Without a known start or
  // end the first / last stop simply takes that place at no cost.
  const points = [start !== null ? start : stopNodes[0]].concat(stopNodes, [end !== null ? end : stopNodes[stopNodes.length - 1]]);
  const d = distanceTable(building, points);
  if (start === null) for (let i = 0; i < points.length; i++) d[0][i] = 0;
  if (end === null) for (let i = 0; i < points.length; i++) d[i][points.length - 1] = 0;
  const order = stopNodes.length <= EXACT_LIMIT ? exactOrder(d) : heuristicOrder(d);

  const stops: Stop[] = order.map((i) => ({ nodeId: points[i], products: byNode.get(points[i])!, checkout: false }));
  let length = d[0][order[0]];
  for (let i = 0; i + 1 < order.length; i++) length += d[order[i]][order[i + 1]];
  if (end !== null) {
    length += d[order[order.length - 1]][points.length - 1];
    stops.push({ nodeId: end, products: [], checkout: true });
  }
  return { stops, length, unknown };
}

/**
 * A shopping trip in progress: what is still to pick up, what has been picked
 * and what was skipped, with the remaining stops always in the best order from
 * where the shopper is. Skipping a product, putting one back or adding a new
 * one re-plans the rest of the trip.
 */
export class ShoppingTrip {
  /** Products still to pick up. */
  pending: string[] = [];
  picked: string[] = [];
  /** Products the shopper gave up on (not on the shelf, changed their mind). */
  skipped: string[] = [];
  /** Remaining stops, the current one first, the checkout last. */
  stops: Stop[] = [];
  /** Walking distance of the remaining stops, metres. */
  length = 0;
  /** Stops already completed. */
  done = 0;
  /** True once the checkout has been reached (or, in a store without one, the last product). */
  finished = false;

  private building: Building;
  private checkedOut = false;

  constructor(building: Building, productIds: string[], startNodeId?: number | null) {
    this.building = building;
    for (const id of productIds) if (building.product(id) && this.pending.indexOf(id) < 0) this.pending.push(id);
    this.replan(startNodeId);
  }

  /** The stop the shopper is heading for. */
  get current(): Stop | null {
    return this.stops.length > 0 ? this.stops[0] : null;
  }

  /** Stops of the whole trip, done and still to do. */
  get total(): number {
    return this.done + this.stops.length;
  }

  /** Puts the remaining stops in the best order from `fromNodeId`. */
  replan(fromNodeId?: number | null) {
    if (this.checkedOut) return;
    const end = checkoutNode(this.building);
    if (this.pending.length === 0) {
      // Nothing left to pick up: only the checkout remains.
      this.stops = end !== null ? [{ nodeId: end, products: [], checkout: true }] : [];
      const from = fromNodeId !== undefined && fromNodeId !== null ? fromNodeId : entranceNode(this.building);
      this.length = end !== null && from !== null ? walkingDistance(this.building, from, end) || 0 : 0;
      this.finished = this.stops.length === 0;
      return;
    }
    const trip = planTrip(this.building, this.pending, fromNodeId);
    this.stops = trip.stops;
    this.length = trip.length;
    this.finished = false;
  }

  /** Everything at the current stop is in the basket: move on. Returns the next stop. */
  completeStop(): Stop | null {
    const stop = this.current;
    if (!stop) return null;
    this.done++;
    if (stop.checkout) {
      this.checkedOut = true;
      this.finished = true;
      this.stops = [];
      this.length = 0;
      return null;
    }
    for (const p of stop.products) {
      this.pending = this.pending.filter((id) => id !== p.id);
      if (this.picked.indexOf(p.id) < 0) this.picked.push(p.id);
    }
    this.replan(stop.nodeId);
    return this.current;
  }

  /** Gives up on one product. The trip is re-planned from `fromNodeId`. */
  skip(productId: string, fromNodeId?: number | null) {
    if (this.pending.indexOf(productId) < 0) return;
    this.pending = this.pending.filter((id) => id !== productId);
    this.skipped.push(productId);
    this.replan(fromNodeId);
  }

  /** Gives up on everything at the current stop. */
  skipStop(fromNodeId?: number | null) {
    const stop = this.current;
    if (!stop || stop.checkout) return;
    for (const p of stop.products) {
      this.pending = this.pending.filter((id) => id !== p.id);
      this.skipped.push(p.id);
    }
    this.replan(fromNodeId);
  }

  /** Adds a product (new, skipped earlier, or even one already picked: "one more"). */
  add(productId: string, fromNodeId?: number | null): boolean {
    if (this.checkedOut || !this.building.product(productId) || this.pending.indexOf(productId) >= 0) return false;
    this.skipped = this.skipped.filter((id) => id !== productId);
    this.picked = this.picked.filter((id) => id !== productId);
    this.pending.push(productId);
    this.replan(fromNodeId);
    return true;
  }
}
