import { venueGraph } from '../../test/venues';

const supermarket = venueGraph('supermarket');
import { Building, RawGraph } from '../building';
import { findRoute, walkingDistance } from '../routing';
import { checkoutNode, entranceNode, planTrip, ShoppingTrip } from '../shopping';

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

describe('changing the trip on the way', () => {
  const stopNames = (trip: ShoppingTrip) => names(trip.stops.map((s) => s.nodeId));

  it('walks through the stops and ends at the checkout', () => {
    const trip = new ShoppingTrip(store, ['milk', 'apples', 'bread', 'butter']);
    expect(stopNames(trip)).toEqual(['Fruit', 'Bakery', 'Milk & yoghurt', 'Checkout']);
    expect([trip.done, trip.total]).toEqual([0, 4]);
    trip.completeStop();
    expect(trip.picked).toEqual(['apples']);
    expect(trip.current!.products.map((p) => p.id)).toEqual(['bread']);
    trip.completeStop();
    trip.completeStop();
    expect(trip.pending).toEqual([]);
    expect(trip.current!.checkout).toBe(true);
    expect(trip.finished).toBe(false);
    expect([trip.done, trip.total]).toEqual([3, 4]);
    expect(trip.completeStop()).toBeNull();
    expect(trip.finished).toBe(true);
    expect(trip.picked.sort()).toEqual(['apples', 'bread', 'butter', 'milk']);
  });

  it('skipping one of two products keeps the stop; skipping the last one removes it', () => {
    const trip = new ShoppingTrip(store, ['milk', 'butter', 'apples']);
    trip.completeStop(); // fruit done
    const dairy = trip.current!.nodeId;
    trip.skip('butter', dairy);
    expect(trip.current!.products.map((p) => p.id)).toEqual(['milk']);
    trip.skip('milk', dairy);
    expect(trip.skipped).toEqual(['butter', 'milk']);
    expect(stopNames(trip)).toEqual(['Checkout']);
    expect(trip.total).toBe(2);
  });

  it('skips a whole stop', () => {
    const trip = new ShoppingTrip(store, ['apples', 'bananas', 'bread']);
    trip.skipStop(entranceNode(store));
    expect(trip.skipped.sort()).toEqual(['apples', 'bananas']);
    expect(stopNames(trip)).toEqual(['Bakery', 'Checkout']);
  });

  it('adding a product re-plans the rest from where the shopper is', () => {
    const trip = new ShoppingTrip(store, ['apples', 'eggs']);
    trip.completeStop(); // at Fruit, heading for Cheese & eggs
    const fruit = store.product('apples')!.nodeId;
    // Vegetables are in the same aisle as the shopper: they come first now.
    expect(trip.add('tomatoes', fruit)).toBe(true);
    expect(stopNames(trip)).toEqual(['Vegetables', 'Cheese & eggs', 'Checkout']);
    // The new order is still the shortest one.
    const orders = permutations(trip.stops.filter((s) => !s.checkout).map((s) => s.nodeId));
    const fromFruit = (order: number[]) => {
      const points = [fruit].concat(order, [checkoutNode(store)!]);
      let total = 0;
      for (let i = 0; i + 1 < points.length; i++) total += walkingDistance(store, points[i], points[i + 1])!;
      return total;
    };
    expect(trip.length).toBeCloseTo(Math.min(...orders.map(fromFruit)), 6);
    // Adding to a section that is already a stop just extends that stop.
    trip.add('mozzarella', fruit);
    expect(trip.stops.length).toBe(3);
    expect(trip.stops[1].products.map((p) => p.id).sort()).toEqual(['eggs', 'mozzarella']);
  });

  it('a skipped product can be put back, and odd requests are ignored', () => {
    const trip = new ShoppingTrip(store, ['milk', 'bread']);
    trip.skip('bread', entranceNode(store));
    expect(stopNames(trip)).toEqual(['Milk & yoghurt', 'Checkout']);
    trip.add('bread', entranceNode(store));
    expect(trip.skipped).toEqual([]);
    expect(stopNames(trip)).toEqual(['Bakery', 'Milk & yoghurt', 'Checkout']);
    expect(trip.add('bread', null)).toBe(false); // already on the list
    expect(trip.add('unicorn-steak', null)).toBe(false);
    trip.skip('not-on-the-list', null);
    expect(trip.skipped).toEqual([]);
  });

  it('with everything skipped only the checkout is left, and nothing can be added after it', () => {
    const trip = new ShoppingTrip(store, ['milk']);
    trip.skip('milk', entranceNode(store));
    expect(stopNames(trip)).toEqual(['Checkout']);
    expect(trip.length).toBeGreaterThan(5);
    trip.completeStop();
    expect(trip.finished).toBe(true);
    expect(trip.add('milk', null)).toBe(false);
  });
});
