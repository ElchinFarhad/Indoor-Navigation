/**
 * Generates src/db/graph.json for the demo building.
 *
 *   node scripts/build-demo-building.js
 *
 * The building is a to-scale two-storey teaching building, 64 m x 40 m: rooms
 * around the outside, a 3 m wide ring corridor, a central block (auditorium
 * and labs) split by a cross corridor that lines up with the main entrance,
 * two staircases and a lift. It is a designed, realistic plan - not a survey
 * of an existing building. To describe a real one, edit graph.json directly
 * (or adapt the tables below): the app only reads the JSON.
 *
 * Units: decimetres (meta.metersPerUnit = 0.1), origin at the top-left corner.
 */
const fs = require('fs');
const path = require('path');

const WIDTH = 640;
const HEIGHT = 400;
const MPU = 0.1;

// Corridor centre lines.
const N = 105, S = 295, W = 105, E = 535, X = 320;

const corridors = [
  { id: 'c-n', x: 90, y: 90, w: 460, h: 30 },
  { id: 'c-s', x: 90, y: 280, w: 460, h: 30 },
  { id: 'c-w', x: 90, y: 120, w: 30, h: 160 },
  { id: 'c-e', x: 520, y: 120, w: 30, h: 160 },
  { id: 'c-x', x: 305, y: 120, w: 30, h: 160 },
];

/**
 * Rooms of one floor: [id, name, short, kind, x, y, w, h, doorX, doorY, nodeX, nodeY]
 * The node is the point on the corridor centre line in front of the door,
 * where the room's QR marker lies.
 */
function rooms(f) {
  const g = f === 0;
  const r = (n) => `${f}.${n}`;
  return [
    // north band
    [r('20'), `Office ${r('20')}`, r('20'), 'office', 0, 0, 130, 90, W, 90, W, N],
    [r('21'), `Seminar room ${r('21')}`, r('21'), 'classroom', 130, 0, 90, 90, 160, 90, 160, N],
    [`stairs-a-${f}`, 'Stairs A', 'Stairs A', 'stairs', 220, 0, 80, 90, 260, 90, 260, N],
    [`lift-${f}`, 'Lift', 'Lift', 'elevator', 300, 0, 40, 90, X, 90, X, N],
    [r('22'), `Classroom ${r('22')}`, r('22'), 'classroom', 340, 0, 90, 90, 370, 90, 370, N],
    [`wc-${f}`, 'Restrooms', 'WC', 'restroom', 430, 0, 80, 90, 470, 90, 470, N],
    [r('23'), `Office ${r('23')}`, r('23'), 'office', 510, 0, 130, 90, E, 90, E, N],
    // west band
    [r('40'), g ? `Classroom ${r('40')}` : `Office ${r('40')}`, r('40'), g ? 'classroom' : 'office', 0, 90, 90, 110, 90, 150, W, 150],
    [r('41'), g ? `Classroom ${r('41')}` : `Office ${r('41')}`, r('41'), g ? 'classroom' : 'office', 0, 200, 90, 110, 90, 250, W, 250],
    // east band
    [`stairs-b-${f}`, 'Stairs B', 'Stairs B', 'stairs', 550, 90, 90, 75, 550, 140, E, 140],
    [r('30'), `Lab ${r('30')}`, r('30'), 'lab', 550, 165, 90, 75, 550, 200, E, 200],
    [r('31'), g ? `Study room ${r('31')}` : `Meeting room ${r('31')}`, r('31'), g ? 'study' : 'office', 550, 240, 90, 70, 550, 260, E, 260],
    // south band
    [r('01'), g ? `Workshop ${r('01')}` : `Computer lab ${r('01')}`, r('01'), 'lab', 0, 310, 180, 90, 150, 310, 150, S],
    g
      ? ['reception', 'Reception', 'Reception', 'reception', 180, 310, 90, 90, 250, 310, 250, S]
      : [r('02'), `Office ${r('02')}`, r('02'), 'office', 180, 310, 90, 90, 250, 310, 250, S],
    g
      ? ['cafe', 'Café', 'Café', 'cafe', 370, 310, 90, 90, 395, 310, 395, S]
      : [r('03'), `Office ${r('03')}`, r('03'), 'office', 370, 310, 90, 90, 395, 310, 395, S],
    g
      ? ['library', 'Library', 'Library', 'library', 460, 310, 180, 90, 495, 310, 495, S]
      : [r('04'), `Reading room ${r('04')}`, r('04'), 'library', 460, 310, 180, 90, 495, 310, 495, S],
    // central block
    g
      ? ['auditorium', 'Auditorium', 'Auditorium', 'auditorium', 120, 120, 185, 160, 215, 120, 215, N]
      : [r('10'), `Lecture hall ${r('10')}`, r('10'), 'auditorium', 120, 120, 185, 160, 215, 120, 215, N],
    [r('11'), `Lab ${r('11')}`, r('11'), 'lab', 335, 120, 185, 80, 420, 120, 420, N],
    [r('12'), `Lab ${r('12')}`, r('12'), 'lab', 335, 200, 185, 80, 445, 280, 445, S],
  ];
}

const floors = [
  { id: 0, name: 'Ground floor', short: 'G', spoken: 'the ground floor' },
  { id: 1, name: 'First floor', short: '1', spoken: 'the first floor' },
];

const nodes = [];
const planFloors = [];
const at = new Map(); // "floor:x:y" -> node

function addNode(floor, x, y, props) {
  const key = `${floor}:${x}:${y}`;
  let node = at.get(key);
  if (!node) {
    node = { name: '', type: 'node', id: nodes.length, x, y, floor, path: [] };
    nodes.push(node);
    at.set(key, node);
  }
  Object.assign(node, props);
  return node;
}

function link(a, b, extra) {
  const weight = extra && extra.weight ? extra.weight : Math.round(Math.hypot(a.x - b.x, a.y - b.y) * MPU * 10) / 10;
  const mk = (to) => Object.assign({ nodeID: to.id, weight }, extra ? { kind: extra.kind, length: extra.length } : {});
  a.path.push(mk(b));
  b.path.push(mk(a));
}

// Ids 0-3 go to the places around the entrance, so the four markers that were
// printed for the first version (local0.pdf ... local3.pdf) land somewhere sensible.
const entrance = addNode(0, X, 372, { type: 'room', label: 'Main entrance', room: 'lobby' });
addNode(0, X, S, { type: 'node', label: 'Lobby' });
addNode(0, 250, S, {});
addNode(0, 395, S, {});

for (const floor of floors) {
  const f = floor.id;
  const planRooms = [];
  for (const [id, name, short, kind, x, y, w, h, doorX, doorY, nodeX, nodeY] of rooms(f)) {
    const type = kind === 'stairs' ? 'stairs' : kind === 'elevator' ? 'elevator' : 'room';
    const node = addNode(f, nodeX, nodeY, { type, label: name, room: id });
    planRooms.push({ id, name, short, kind, x, y, w, h, doors: [{ x: doorX, y: doorY }], node: node.id });
  }
  if (f === 0) {
    planRooms.push({
      id: 'lobby', name: 'Lobby', short: 'Lobby', kind: 'lobby', x: 270, y: 310, w: 100, h: 90,
      doors: [{ x: X, y: 310, width: 100 }, { x: X, y: 400, width: 24, entrance: true }], node: entrance.id,
    });
  } else {
    const lounge = addNode(f, X, S, { type: 'room', label: 'Student lounge', room: 'lounge' });
    planRooms.push({
      id: 'lounge', name: 'Student lounge', short: 'Lounge', kind: 'study', x: 270, y: 310, w: 100, h: 90,
      doors: [{ x: X, y: 310, width: 30 }], node: lounge.id,
    });
  }
  // Plain junctions: the two southern corners and the middle of the cross corridor.
  addNode(f, W, S, { label: 'South-west corner' });
  addNode(f, E, S, { label: 'South-east corner' });
  addNode(f, X, 200, { label: 'Central corridor' });

  // Corridors: connect the nodes that lie on each centre line, in order.
  const onLine = (test, key) => nodes.filter((n) => n.floor === f && test(n)).sort((a, b) => a[key] - b[key]);
  const lines = [
    onLine((n) => n.y === N, 'x'),
    onLine((n) => n.y === S, 'x'),
    onLine((n) => n.x === W && n.y >= N && n.y <= S, 'y'),
    onLine((n) => n.x === E && n.y >= N && n.y <= S, 'y'),
    onLine((n) => n.x === X && n.y >= N && n.y <= S, 'y'),
  ];
  for (const line of lines) for (let i = 0; i + 1 < line.length; i++) link(line[i], line[i + 1]);

  planFloors.push(Object.assign({}, floor, { width: WIDTH, height: HEIGHT, corridors, rooms: planRooms }));
}
link(entrance, at.get(`0:${X}:${S}`));

// Between the floors.
link(at.get(`0:260:${N}`), at.get(`1:260:${N}`), { kind: 'stairs', length: 9, weight: 14 });
link(at.get(`0:${E}:140`), at.get(`1:${E}:140`), { kind: 'stairs', length: 9, weight: 14 });
link(at.get(`0:${X}:${N}`), at.get(`1:${X}:${N}`), { kind: 'elevator', length: 4, weight: 24 });

// Marker codes: G01, G02 ... on the ground floor, F01 ... on the first.
const counters = {};
for (const n of nodes) {
  const prefix = n.floor === 0 ? 'G' : 'F';
  counters[prefix] = (counters[prefix] || 0) + 1;
  n.name = `${prefix}${String(counters[prefix]).padStart(2, '0')}`;
}

// Stable key order: the classic fields first, as in the original file.
const ordered = nodes.map((n) => {
  const out = { name: n.name, type: n.type, id: n.id, x: n.x, y: n.y, floor: n.floor };
  if (n.label) out.label = n.label;
  if (n.room) out.room = n.room;
  out.path = n.path;
  return out;
});

const graph = {
  meta: {
    name: 'Engineering Building',
    metersPerUnit: MPU,
    qrSize: 0.18,
    floors: planFloors,
  },
  nodes: ordered,
};

const file = path.resolve(__dirname, '../src/db/graph.json');
fs.writeFileSync(file, JSON.stringify(graph, null, 1) + '\n');
console.log(`Wrote ${ordered.length} nodes, ${planFloors.reduce((a, f) => a + f.rooms.length, 0)} rooms to ${file}`);
