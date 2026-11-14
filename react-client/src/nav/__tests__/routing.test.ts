import { building as shipped, shortestPathF } from '../../db/dijkstra';
import { Building, parseMarkerId, RawGraph } from '../building';
import thesis from './fixtures/thesis-building.json';

// The small building of the original thesis demo: a compact, well-understood
// graph to test the algorithms on, independent of whatever building ships.
const building = new Building(thesis as RawGraph);
import { findRoute, shortestPath, walkingDistance, pointAlongRoute } from '../routing';
import { buildManeuvers, classifyTurn, guidanceAt } from '../instructions';
import { DEG } from '../geometry';

const id = (name: string, floor = 0) => building.nodes.find((n) => n.name === name && n.floor === floor)!.id;

describe('building model', () => {
  it('loads the JSON database without warnings', () => {
    expect(building.warnings).toEqual([]);
    expect(building.nodes.length).toBeGreaterThanOrEqual(5);
    expect(building.floors.map((f) => f.id)).toEqual([0, 1]);
  });

  it('keeps the original five nodes where the printed QR codes expect them', () => {
    const expected = [
      [0, 'A', 155, 260, 'room'],
      [1, 'B', 65, 260, 'node'],
      [2, 'C', 65, 225, 'node'],
      [3, 'D', 228, 260, 'room'],
      [4, 'E', 230, 225, 'room'],
    ];
    for (const [nodeId, name, x, y, type] of expected) {
      const n = building.node(nodeId as number)!;
      expect([n.id, n.name, n.x, n.y, n.type]).toEqual([nodeId, name, x, y, type]);
    }
  });

  it('makes every link symmetric', () => {
    for (const n of building.nodes) {
      for (const e of building.edgesFrom(n.id)) {
        const back = building.edge(e.to, e.from)!;
        expect(back).toBeDefined();
        expect(back.cost).toBe(e.cost);
        expect(back.length).toBeCloseTo(e.length);
      }
    }
  });

  it('repairs one-way and asymmetric links of older graph files', () => {
    const b = new Building({
      nodes: [
        { name: 'A', type: 'room', id: 0, x: 0, y: 0, path: [{ nodeID: 1, weight: 4 }] },
        { name: 'B', type: 'node', id: 1, x: 10, y: 0, path: [{ nodeID: 0, weight: 2 }, { nodeID: 2, weight: 3 }, { nodeID: 9, weight: 1 }] },
        { name: 'C', type: 'room', id: 2, x: 10, y: 10, path: [] },
      ],
    });
    expect(b.edge(0, 1)!.cost).toBe(2);
    expect(b.edge(1, 0)!.cost).toBe(2);
    expect(b.edge(2, 1)).toBeDefined();
    expect(b.warnings.length).toBe(2);
    expect(shortestPath(b, 0, 2)!.nodeIds).toEqual([0, 1, 2]);
  });

  it('parses the marker id out of the printed QR payload', () => {
    expect(parseMarkerId('http://localhost:3000/qrScanner/3')).toBe(3);
    expect(parseMarkerId('https://nav.example.org/app/qrScanner/12?x=1')).toBe(12);
    expect(parseMarkerId('https://nav.example.org/?at=7')).toBe(7);
    expect(parseMarkerId('http://localhost:3000/')).toBeNull();
    expect(parseMarkerId('hello')).toBeNull();
  });
});

describe('routing', () => {
  it('finds the route of the thesis demonstration (C to D)', () => {
    expect(shortestPath(building, id('C'), id('D'))!.nodeIds).toEqual([2, 1, 0, 3]);
  });

  it('picks the shorter way around the central hall', () => {
    // G (top left) to L (right): along the top corridor, not around the bottom.
    expect(shortestPath(building, id('G'), id('L'))!.nodeIds.map((n) => building.node(n)!.name)).toEqual(['G', 'H', 'J', 'K', 'L']);
    // F (left) to D (bottom right): around the bottom.
    expect(shortestPath(building, id('F'), id('D'))!.nodeIds.map((n) => building.node(n)!.name)).toEqual(['F', 'C', 'B', 'A', 'D']);
  });

  it('routes across floors through the stairs', () => {
    const route = findRoute(building, { nodeId: id('A') }, id('R', 1))!;
    expect(route).not.toBeNull();
    const kinds = route.legs.map((l) => l.kind);
    expect(kinds.filter((k) => k === 'stairs').length).toBe(1);
    expect(route.points[route.points.length - 1].floor).toBe(1);
    const maneuvers = buildManeuvers(building, route);
    const stairs = maneuvers.find((m) => m.type === 'stairs-up')!;
    expect(stairs.text).toBe('Take the stairs up');
    expect(stairs.detail).toBe('to First floor');
    expect(maneuvers[maneuvers.length - 1].type).toBe('arrive');
  });

  it('returns null instead of throwing when there is no path', () => {
    expect(shortestPath(building, 0, 999)).toBeNull();
    expect(shortestPath(building, 999, 0)).toBeNull();
    expect(findRoute(building, { nodeId: 0 }, 999)).toBeNull();
  });

  it('can start in the middle of a corridor and leaves through the better end', () => {
    const ab = building.edge(id('A'), id('B'))!;
    // 2 m from A towards B, going to D: turn back through A.
    const back = findRoute(building, { from: id('A'), to: id('B'), t: 2 }, id('D'))!;
    expect(back.nodeIds).toEqual([id('A'), id('D')]);
    expect(back.points[0].nodeId).toBeNull();
    expect(back.legs[0].length).toBeCloseTo(2);
    expect(back.length).toBeCloseTo(2 + building.edge(id('A'), id('D'))!.length);
    // Same spot, going to C: carry on through B.
    const on = findRoute(building, { from: id('A'), to: id('B'), t: 2 }, id('C'))!;
    expect(on.nodeIds).toEqual([id('B'), id('C')]);
    expect(on.legs[0].length).toBeCloseTo(ab.length - 2);
    // The start point really is 2 m from A.
    expect(on.points[0].x).toBeCloseTo(155 - 20);
    expect(on.points[0].y).toBeCloseTo(260);
  });

  it('measures walking distance and interpolates along a route', () => {
    expect(walkingDistance(building, id('C'), id('D'))).toBeCloseTo(3.5 + 9 + 7.3, 1);
    const route = findRoute(building, { nodeId: id('B') }, id('D'))!;
    const p = pointAlongRoute(route, 9 + 3.65);
    expect(p.x).toBeCloseTo((155 + 228) / 2, 0);
    expect(p.legIndex).toBe(1);
  });
});

describe('legacy shortestPathF', () => {
  const lobby = shipped.nodes.find((n) => n.label === 'Lobby')!;
  const entrance = shipped.nodes.find((n) => n.label === 'Main entrance')!;
  const cafe = shipped.nodes.find((n) => n.label === 'Café')!;

  it('keeps its result shape', () => {
    const r = shortestPathF(entrance.id, cafe.id);
    expect(r.shortestPathArray).toEqual([entrance.id, lobby.id, cafe.id]);
    expect([r.nextNodeX, r.nextNodeY]).toEqual([lobby.x, lobby.y]);
  });

  it('no longer throws for the same node, string ids or unknown nodes', () => {
    expect(shortestPathF(3, 3).shortestPathArray).toEqual([3]);
    expect(shortestPathF(String(entrance.id) as any, cafe.id).shortestPathArray).toEqual([entrance.id, lobby.id, cafe.id]);
    expect(shortestPathF(0, 999).shortestPathArray).toEqual([]);
  });
});

describe('the shipped building', () => {
  const byLabel = (label: string, floor = 0) => shipped.nodes.find((n) => n.label === label && n.floor === floor)!;

  it('loads without warnings and has a vector plan for every floor', () => {
    expect(shipped.warnings).toEqual([]);
    expect(shipped.hasPlan).toBe(true);
    for (const f of shipped.floors) {
      expect(f.rooms.length).toBeGreaterThan(10);
      expect(f.corridors.length).toBeGreaterThan(0);
    }
  });

  it('puts every node on a corridor, in front of the door of its room', () => {
    for (const n of shipped.nodes) {
      const floor = shipped.floor(n.floor)!;
      const inCorridor = floor.corridors.some((c) => n.x >= c.x && n.x <= c.x + c.w && n.y >= c.y && n.y <= c.y + c.h);
      const room = shipped.roomOf(n);
      if (room && room.kind === 'lobby') continue; // the entrance marker is inside the lobby
      expect(inCorridor).toBe(true);
      if (room) {
        const door = room.doors![0];
        expect(Math.hypot(door.x - n.x, door.y - n.y) * shipped.metersPerUnit).toBeLessThanOrEqual(1.6);
        expect(room.node).toBe(n.id);
      }
    }
  });

  it('has only straight, axis-aligned corridor links of plausible length', () => {
    for (const n of shipped.nodes) {
      for (const e of shipped.edgesFrom(n.id)) {
        const o = shipped.node(e.to)!;
        if (e.kind !== 'walk') continue;
        expect(n.x === o.x || n.y === o.y).toBe(true);
        expect(e.length).toBeGreaterThan(2);
        expect(e.length).toBeLessThan(12);
      }
    }
  });

  it('can reach every room from the main entrance', () => {
    const entranceId = byLabel('Main entrance').id;
    for (const room of shipped.rooms()) {
      expect(findRoute(shipped, { nodeId: entranceId }, room.id)).not.toBeNull();
    }
  });

  it('goes straight through the cross corridor from the entrance to the lift', () => {
    const route = findRoute(shipped, { nodeId: byLabel('Main entrance').id }, byLabel('Lift').id)!;
    expect(route.nodeIds.map((n) => shipped.node(n)!.label)).toEqual(['Main entrance', 'Lobby', 'Central corridor', 'Lift']);
    expect(buildManeuvers(shipped, route).map((m) => m.type)).toEqual(['arrive']);
  });

  it('prefers the stairs but offers a step-free route through the lift', () => {
    const from = byLabel('Main entrance').id;
    const to = byLabel('Lab 1.30', 1).id;
    const normal = findRoute(shipped, { nodeId: from }, to)!;
    expect(normal.legs.filter((l) => l.kind === 'stairs').length).toBe(1);
    const stepFree = findRoute(shipped, { nodeId: from }, to, { avoidStairs: true })!;
    expect(stepFree.legs.some((l) => l.kind === 'stairs')).toBe(false);
    expect(stepFree.legs.filter((l) => l.kind === 'elevator').length).toBe(1);
    const lift = buildManeuvers(shipped, stepFree).find((m) => m.type === 'elevator-up')!;
    expect(lift.text).toBe('Take the lift up');
    expect(lift.detail).toBe('to First floor (Lift)');
  });

  it('names landmarks in turn instructions', () => {
    const route = findRoute(shipped, { nodeId: byLabel('Main entrance').id }, byLabel('Classroom 0.40').id)!;
    const m = buildManeuvers(shipped, route);
    expect(m.map((x) => x.type)).toEqual(['left', 'right', 'arrive']);
    expect(m[0].detail).toBe('at the lobby');
    expect(m[1].detail).toBe('at the south-west corner');
    expect(m[2].text).toBe('Arrive at Classroom 0.40');
  });
});

describe('instructions', () => {
  it('classifies turns (right is positive on a y-down map)', () => {
    expect(classifyTurn(0)).toBe('straight');
    expect(classifyTurn(90 * DEG)).toBe('right');
    expect(classifyTurn(-90 * DEG)).toBe('left');
    expect(classifyTurn(40 * DEG)).toBe('slight-right');
    expect(classifyTurn(-140 * DEG)).toBe('sharp-left');
    expect(classifyTurn(175 * DEG)).toBe('uturn');
  });

  it('describes the thesis route C -> B -> A -> D', () => {
    // C is above B; walking down to B then right towards A is a left turn.
    const route = findRoute(building, { nodeId: id('C') }, id('D'))!;
    const m = buildManeuvers(building, route);
    expect(m.map((x) => x.type)).toEqual(['left', 'arrive']);
    expect(m[0].detail).toBe('at marker B');
    expect(m[0].at).toBeCloseTo(3.5);
    expect(m[1].text).toBe('Arrive at Room D');

    expect(guidanceAt(m, 0)!.headline).toBe('In 4 m, turn left');
    expect(guidanceAt(m, 3.4)!.headline).toBe('Turn left');
    const later = guidanceAt(m, 10)!;
    expect(later.maneuver.type).toBe('arrive');
    expect(later.headline).toBe('Continue 10 m');
    expect(guidanceAt(m, route.length)!.headline).toBe('Arrive at Room D');
  });

  it('uses the walking direction to tell the user to turn at the very start', () => {
    const route = findRoute(building, { nodeId: id('B') }, id('A'))!; // heading right (0 rad)
    expect(buildManeuvers(building, route, 0).map((x) => x.type)).toEqual(['arrive']);
    expect(buildManeuvers(building, route, Math.PI)[0].type).toBe('uturn');
    expect(buildManeuvers(building, route, 90 * DEG)[0].type).toBe('left');
  });
});
