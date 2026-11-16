import { venueGraph } from '../../test/venues';
import { Building } from '../../nav/building';
import { walkingDistance } from '../../nav/routing';
import { checkoutNode, entranceNode, planTrip, ShoppingTrip } from '../../nav/shopping';
import { wallSegments } from '../../map/plan';

const building = new Building(venueGraph('carrefour'));
const floor = building.floors[0];
const store = floor.outlines.find((o) => o.kind === 'store')!;

function inside(poly: number[][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

describe('Carrefour Montesson (real outline, real products)', () => {
  it('is a store with the surveyed outline of the sales floor', () => {
    expect(building.type).toBe('store');
    expect(building.attribution).toMatch(/OpenStreetMap/);
    expect(building.attribution).toMatch(/Open Food Facts/);
    expect(building.attribution).toMatch(/illustrative/);
    expect(store.points.length).toBeGreaterThan(10);
    // The real sales floor is about 231 m long and 9 300 m2.
    const xs = store.points.map((p) => p[0]);
    expect((Math.max(...xs) - Math.min(...xs)) * building.metersPerUnit).toBeGreaterThan(220);
    let area = 0;
    for (let i = 0; i + 1 < store.points.length; i++) area += store.points[i][0] * store.points[i + 1][1] - store.points[i + 1][0] * store.points[i][1];
    const m2 = (Math.abs(area) / 2) * building.metersPerUnit * building.metersPerUnit;
    expect(m2).toBeGreaterThan(9000);
    expect(m2).toBeLessThan(9600);
    expect(floor.outlines.filter((o) => o.kind === 'shop' && o.name).length).toBeGreaterThan(30);
  });

  it('keeps every marker, stop and shelf inside the real outline', () => {
    for (const n of building.nodes) expect([n.name, inside(store.points, n.x, n.y)]).toEqual([n.name, true]);
    for (const room of floor.rooms) {
      expect([room.id, inside(store.points, room.x + room.w / 2, room.y + room.h / 2)]).toEqual([room.id, true]);
    }
  });

  it('opens the outline wall at the two surveyed entrances', () => {
    const entrances = floor.rooms.filter((r) => r.kind === 'lobby');
    expect(entrances.length).toBe(2);
    const walls = wallSegments(floor, building.metersPerUnit);
    for (const lobby of entrances) {
      const door = lobby.doors!.find((d) => d.entrance)!;
      const blocked = walls.some((s) => {
        const dx = s.x2 - s.x1;
        const dy = s.y2 - s.y1;
        const length = Math.hypot(dx, dy);
        if (dy === 0 || dx === 0) return false; // walls of rooms: only the outline runs at an angle... or not
        const along = ((door.x - s.x1) * dx + (door.y - s.y1) * dy) / length;
        const across = Math.abs((door.x - s.x1) * dy - (door.y - s.y1) * dx) / length;
        return across < 1 && along > 1 && along < length - 1;
      });
      expect([lobby.id, blocked]).toEqual([lobby.id, false]);
    }
  });

  it('can walk from the main entrance to every section and to the checkout', () => {
    const entrance = entranceNode(building)!;
    expect(building.node(entrance)!.label).toBe('Main entrance');
    expect(checkoutNode(building)).not.toBeNull();
    for (const room of floor.rooms) {
      const d = walkingDistance(building, entrance, room.node!);
      expect([room.id, d !== null && d < 400]).toEqual([room.id, true]);
    }
  });

  it('has real products with barcodes, each on a shelf of the food hall', () => {
    expect(building.products.length).toBeGreaterThan(200);
    for (const p of building.products) {
      expect(p.id).toMatch(/^\d{8,14}$/); // EAN barcode
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.section.solid).toBe(true);
    }
    expect(building.products.filter((p) => p.brand).length).toBeGreaterThan(building.products.length * 0.8);
    expect(building.featured.length).toBeGreaterThan(4);
  });

  it('plans a trip through a hypermarket-sized store and re-plans it on the way', () => {
    const pick = (section: string) => building.products.find((p) => p.section.id === section)!.id;
    const list = ['wines', 'milks', 'fruits', 'pastas', 'ice-creams', 'coffees', 'cheeses', 'breads'].map(pick);
    const trip = planTrip(building, list, null);
    expect(trip.stops.length).toBe(9); // eight shelves and the checkout
    expect(trip.stops[trip.stops.length - 1].nodeId).toBe(checkoutNode(building));
    // Not worse than walking the list in the order it was written.
    let naive = 0;
    let at = entranceNode(building)!;
    for (const id of list) {
      const next = building.product(id)!.nodeId;
      naive += walkingDistance(building, at, next)!;
      at = next;
    }
    naive += walkingDistance(building, at, checkoutNode(building)!)!;
    expect(trip.length).toBeLessThanOrEqual(naive + 0.01);
    expect(trip.length).toBeGreaterThan(100);

    const live = new ShoppingTrip(building, list);
    const first = live.current!;
    live.skipStop(first.nodeId);
    expect(live.skipped.length).toBeGreaterThan(0);
    expect(live.add(pick('yogurts'), first.nodeId)).toBe(true);
    expect(live.pending.length).toBe(list.length);
  });
});
