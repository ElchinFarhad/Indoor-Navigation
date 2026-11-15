import supermarket from '../../db/supermarket.json';
import { Building, RawGraph } from '../building';
import { findRoute, walkingDistance } from '../routing';
import { checkoutNode, entranceNode, planTrip } from '../shopping';

const store = new Building(supermarket as RawGraph);
const names = (ids: number[]) => ids.map((i) => store.node(i)!.label);

/** Length of visiting the stops in the given order, entrance to checkout. */
function tourLength(order: number[]): number {
  const points = [entranceNode(store)!].concat(order, [checkoutNode(store)!]);
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) total += walkingDistance(store, points[i], points[i + 1])!;
  return total;
}

function permutations(items: number[]): number[][] {
  if (items.length <= 1) return [items];
  const out: number[][] = [];
  items.forEach((item, i) => {
    for (const rest of permutations(items.slice(0, i).concat(items.slice(i + 1)))) out.push([item].concat(rest));
  });
  return out;
}

describe('the demo supermarket', () => {
  it('loads cleanly as a store with products on its shelves', () => {
    expect(store.warnings).toEqual([]);
    expect(store.type).toBe('store');
    expect(store.products.length).toBeGreaterThan(80);
    for (const p of store.products) {
      expect(store.node(p.nodeId)!.roomId).toBe(p.section.id);
      expect(p.section.solid).toBe(true);
    }
    expect(new Set(store.products.map((p) => p.id)).size).toBe(store.products.length);
  });

  it('needs only a handful of markers: aisle ends, entrance and checkout', () => {
    const markers = store.markers();
    expect(markers.length).toBe(14);
    expect(store.nodes.length).toBeGreaterThan(markers.length * 2);
    // Every shelf stop is within one aisle length of a marker.
    for (const n of store.nodes) {
      const nearest = Math.min(...markers.map((m) => walkingDistance(store, n.id, m.id)!));
      expect(nearest).toBeLessThanOrEqual(10.5);
    }
  });

  it('can route from the entrance to every section and to the checkout', () => {
    for (const room of store.rooms()) expect(findRoute(store, { nodeId: entranceNode(store)! }, room.id)).not.toBeNull();
    expect(store.node(checkoutNode(store)!)!.label).toBe('Checkout');
  });
});

describe('planning a shopping trip', () => {
  it('groups products of one section into one stop and ends at the checkout', () => {
    const trip = planTrip(store, ['milk', 'butter', 'yoghurt', 'bread']);
    expect(names(trip.stops.map((s) => s.nodeId))).toEqual(['Bakery', 'Milk & yoghurt', 'Checkout']);
    expect(trip.stops[1].products.map((p) => p.name).sort()).toEqual(['Butter', 'Milk', 'Yoghurt']);
    expect(trip.stops[2].checkout).toBe(true);
    expect(trip.stops[2].products).toEqual([]);
  });

  it('finds the shortest order (checked against every possible order)', () => {
    const list = ['apples', 'spaghetti', 'cola', 'frozen-pizza', 'toilet-paper', 'eggs', 'salmon'];
    const trip = planTrip(store, list);
    const stops = trip.stops.filter((s) => !s.checkout).map((s) => s.nodeId);
    expect(stops.length).toBe(7);
    const best = Math.min(...permutations(stops).map(tourLength));
    expect(trip.length).toBeCloseTo(best, 6);
    expect(tourLength(stops)).toBeCloseTo(best, 6);
    // ...and it is a real saving over walking the list in the order it was written.
    const asWritten = ['eggs', 'apples', 'toilet-paper', 'spaghetti', 'salmon', 'cola', 'frozen-pizza'].map((id) => store.product(id)!.nodeId);
    expect(tourLength(asWritten)).toBeGreaterThan(best * 1.5);
  });

  it('starts from where the shopper actually is', () => {
    const list = ['apples', 'eggs'];
    const fromEntrance = planTrip(store, list);
    expect(names(fromEntrance.stops.map((s) => s.nodeId))).toEqual(['Fruit', 'Cheese & eggs', 'Checkout']);
    const dairy = store.product('eggs')!.nodeId;
    const fromDairy = planTrip(store, list, dairy);
    expect(names(fromDairy.stops.map((s) => s.nodeId))[0]).toBe('Cheese & eggs');
  });

  it('copes with long lists, duplicates, unknown products and an empty list', () => {
    const everything = store.products.map((p) => p.id);
    const trip = planTrip(store, everything.concat(everything));
    const sections = new Set(store.products.map((p) => p.nodeId));
    expect(trip.stops.length).toBe(sections.size + 1);
    expect(new Set(trip.stops.map((s) => s.nodeId)).size).toBe(trip.stops.length);
    // A serpentine through six aisles of 20 m: sensible, not a zig-zag across the shop.
    expect(trip.length).toBeLessThan(260);

    const odd = planTrip(store, ['milk', 'unicorn-steak']);
    expect(odd.unknown).toEqual(['unicorn-steak']);
    expect(odd.stops.length).toBe(2);
    expect(planTrip(store, []).stops).toEqual([]);
  });
});
