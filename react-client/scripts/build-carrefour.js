/**
 * Generates src/db/carrefour-montesson.json: a venue built on real, open data.
 *
 *   node scripts/fetch-carrefour-data.js   # refresh the snapshots (needs network)
 *   node scripts/build-carrefour.js        # build the venue from the snapshots
 *
 * What is real
 *  - The outline of the Carrefour hypermarket in the Montesson shopping centre
 *    (near Paris), its two entrances, the mall building and the neighbouring
 *    shops: surveyed by OpenStreetMap contributors (indoor mapping).
 *  - The products: what Open Food Facts contributors recorded as sold at
 *    Carrefour in France, with brand, pack size, barcode and photo.
 *
 * What is NOT real, because no retailer publishes it
 *  - The aisles inside the store, which category stands where, and the
 *    positions of the QR markers. They are laid out here to fit the real
 *    outline at realistic dimensions (see the constants below).
 *
 * Frame: x runs along the store's long back wall, y from the back wall towards
 * the mall, both in metres from one end of that wall; the file stores them in
 * map units (meta.metersPerUnit) after an offset that keeps the whole mall
 * inside the sheet.
 */
const fs = require('fs');
const path = require('path');

const DATA = path.resolve(__dirname, 'data/carrefour-montesson');
const osm = JSON.parse(fs.readFileSync(path.join(DATA, 'osm.json'), 'utf8'));
const off = JSON.parse(fs.readFileSync(path.join(DATA, 'off-products.json'), 'utf8'));
const SECTIONS = require('./carrefour-sections');

const MPU = 0.2; // metres per map unit
const PER_SECTION = 6;

/* ------------------------------------------------------------ real geometry */

const osmNodes = new Map(osm.nodes.map((n) => [n.id, n]));
const lat0 = (osm.bbox[1] + osm.bbox[3]) / 2;
const lon0 = (osm.bbox[0] + osm.bbox[2]) / 2;
const K = 111320;
/** Metres east / north of the centre of the bounding box. */
const eastNorth = (n) => [(n.lon - lon0) * K * Math.cos((lat0 * Math.PI) / 180), (n.lat - lat0) * K];

const storeWay = osm.ways.find((w) => w.id === osm.storeWay);
const storeEN = storeWay.nodes.map((id) => eastNorth(osmNodes.get(id)));

// The store frame: along the longest wall, with the store on the +y side.
let longest = 0;
for (let i = 1; i + 1 < storeEN.length; i++) {
  const len = (j) => Math.hypot(storeEN[j + 1][0] - storeEN[j][0], storeEN[j + 1][1] - storeEN[j][1]);
  if (len(i) > len(longest)) longest = i;
}
let A = storeEN[longest];
let B = storeEN[longest + 1];
const centre = storeEN.slice(0, -1).reduce((s, p) => [s[0] + p[0] / (storeEN.length - 1), s[1] + p[1] / (storeEN.length - 1)], [0, 0]);
const frameOf = (a, b) => {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  let n = [-u[1], u[0]];
  if ((centre[0] - a[0]) * n[0] + (centre[1] - a[1]) * n[1] < 0) n = [-n[0], -n[1]];
  return { a, u, n, cross: u[0] * n[1] - u[1] * n[0] };
};
let frame = frameOf(A, B);
// On a screen y points down: the frame must be left-handed in east/north, or the map would be mirrored.
if (frame.cross > 0) frame = frameOf(B, A);
/** East/north metres -> store frame metres. */
const toStore = (p) => [
  (p[0] - frame.a[0]) * frame.u[0] + (p[1] - frame.a[1]) * frame.u[1],
  (p[0] - frame.a[0]) * frame.n[0] + (p[1] - frame.a[1]) * frame.n[1],
];
const wayPoints = (w) => w.nodes.map((id) => toStore(eastNorth(osmNodes.get(id))));

const storePoly = wayPoints(storeWay);
const mall = osm.ways.find((w) => w.tags.shop === 'mall');
const mallPoly = wayPoints(mall);

// Sheet: the mall plus a margin; everything is shifted so that it starts at 0,0.
const PAD = 8;
const minX = Math.min(...mallPoly.map((p) => p[0]), ...storePoly.map((p) => p[0])) - PAD;
const minY = Math.min(...mallPoly.map((p) => p[1]), ...storePoly.map((p) => p[1])) - PAD;
const maxX = Math.max(...mallPoly.map((p) => p[0]), ...storePoly.map((p) => p[0])) + PAD;
const maxY = Math.max(...mallPoly.map((p) => p[1]), ...storePoly.map((p) => p[1])) + PAD;
const r1 = (v) => Math.round(v * 10) / 10;
/** Store frame metres -> map units. */
const ux = (x) => r1((x - minX) / MPU);
const uy = (y) => r1((y - minY) / MPU);
const upoly = (poly) => poly.map((p) => [ux(p[0]), uy(p[1])]);

function inside(poly, x, y) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const outlines = [{ id: 'mall', name: '', kind: 'site', points: upoly(mallPoly) }];
for (const w of osm.ways) {
  if (w === storeWay || w === mall) continue;
  const t = w.tags;
  const corridor = t.indoor === 'corridor';
  outlines.push({ id: `osm-${w.id}`, name: corridor ? '' : t.name || '', kind: corridor ? 'corridor' : 'shop', points: upoly(wayPoints(w)) });
}
outlines.push({ id: 'store', name: '', kind: 'store', points: upoly(storePoly) });

// Entrances of the store: OSM entrance nodes that sit on its outline.
const entrances = storeWay.nodes
  .map((id) => osmNodes.get(id))
  .filter((n) => n.tags && n.tags.entrance)
  .map((n) => ({ main: n.tags.entrance === 'main', at: toStore(eastNorth(n)) }))
  .sort((a, b) => Number(b.main) - Number(a.main));
if (entrances.length === 0) throw new Error('The store outline has no entrance in the OSM snapshot');

/* ---------------------------------------------------------- designed layout */

const BACK = 4, MID = 19, FRONT = 34; // centre lines of the cross aisles (m from the back wall)
const REAR = [7, 17.5], NEAR = [20.5, 31]; // the two halves of every gondola
const STOP = { rearLeft: 10.5, rearRight: 14, frontLeft: 24, frontRight: 27.5 };
const HALF_AISLE = 1.8, SHELF = 1.7;
const NONFOOD_PITCH = 15.5, FOOD_PITCH = 7;
const NONFOOD_X0 = 36;

const NONFOOD = [
  ['multimedia', 'TV, audio & phones', 'household'], ['appliances', 'Home appliances', 'household'],
  ['kitchen', 'Kitchen & tableware', 'household'], ['home', 'Home & decoration', 'household'],
  ['clothing', 'Clothing', 'care'], ['shoes', 'Shoes & accessories', 'care'],
  ['toys', 'Toys & games', 'care'], ['books', 'Books & stationery', 'care'],
  ['beauty', 'Health & beauty', 'care'], ['cleaning', 'Cleaning & laundry', 'household'],
];
const COUNTERS = [['bakery-counter', 'Bakery counter', 'bakery'], ['butcher', 'Butcher', 'meat'], ['fishmonger', 'Fishmonger', 'fish'], ['cheese-counter', 'Cheese counter', 'dairy'], ['deli', 'Deli counter', 'meat']];

const nonfoodAisles = [];
for (let k = 0; k <= NONFOOD.length / 2; k++) nonfoodAisles.push(NONFOOD_X0 + NONFOOD_PITCH * k);
const FOOD_X0 = nonfoodAisles[nonfoodAisles.length - 1];
const foodAisles = [];
for (let j = 1; j <= SECTIONS.length / 4; j++) foodAisles.push(FOOD_X0 + FOOD_PITCH * j);
const aisles = nonfoodAisles.concat(foodAisles);

const nodes = [];
const rooms = [];
const at = new Map();

function node(x, y, props) {
  const key = `${r1(x)}:${r1(y)}`;
  let n = at.get(key);
  if (!n) {
    if (!inside(storePoly, x, y)) throw new Error(`Node ${key} is outside the real store outline`);
    n = { name: '', type: 'node', id: nodes.length, mx: x, my: y, qr: false, path: [] };
    nodes.push(n);
    at.set(key, n);
  }
  Object.assign(n, props || {});
  return n;
}

function link(a, b) {
  if (a.path.some((p) => p.nodeID === b.id)) return;
  const weight = Math.round(Math.hypot(a.mx - b.mx, a.my - b.my) * 10) / 10;
  a.path.push({ nodeID: b.id, weight });
  b.path.push({ nodeID: a.id, weight });
}

function rect(x, y, w, h) {
  for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    if (!inside(storePoly, px + (px === x ? 0.05 : -0.05), py + (py === y ? 0.05 : -0.05))) throw new Error(`A block at ${x},${y} sticks out of the real store outline`);
  }
  return { x: ux(x), y: uy(y), w: r1(w / MPU), h: r1(h / MPU) };
}

/** A shelf or department: a solid block with one face towards the stop in its aisle. */
function block(id, name, kind, x, y, w, h, faceX, faceY, stop) {
  Object.assign(stop, { type: 'room', label: name, room: id });
  rooms.push({ id, name, short: name, kind, solid: true, ...rect(x, y, w, h), doors: [{ x: ux(faceX), y: uy(faceY) }], node: stop.id });
}

// Entrances first: the main one gets id 0 and is where a trip starts by default.
const frontDepthAt = (x) => {
  // Depth of the store's front wall at this position along the back wall.
  let depth = 0;
  for (let y = FRONT; y < 80; y += 0.1) {
    if (!inside(storePoly, x, y)) break;
    depth = y;
  }
  return depth;
};
entrances.forEach((e, i) => {
  const x = e.at[0];
  const wall = Math.min(e.at[1], frontDepthAt(x));
  const top = FRONT + 4.5;
  const half = 4.5;
  const n = node(x, (top + wall) / 2, { type: 'room', label: e.main ? 'Main entrance' : 'Mall entrance', room: i === 0 ? 'entrance' : `entrance-${i + 1}`, qr: true });
  rooms.push({
    id: n.room,
    name: n.label,
    short: 'Entrance',
    kind: 'lobby',
    x: ux(x - half), y: uy(top), w: r1((2 * half) / MPU), h: r1((wall - top) / MPU),
    doors: [{ x: ux(x), y: uy(top), width: r1(5 / MPU) }, { x: ux(x), y: uy(wall), width: r1(4 / MPU), entrance: true }],
    node: n.id,
  });
  link(n, node(x, FRONT, { label: 'front aisle' }));
});

// Cross aisles: a marker at the back and at the front of every aisle.
aisles.forEach((x, i) => {
  const label = i < nonfoodAisles.length ? `department aisle ${i + 1}` : `aisle ${i - nonfoodAisles.length + 1}`;
  node(x, BACK, { label: `back of ${label}`, qr: true });
  node(x, MID, { label: `middle of ${label}` });
  node(x, FRONT, { label: `front of ${label}`, qr: true });
});

// Non-food departments: big blocks between the wide aisles, two deep.
for (let k = 0; k + 1 < nonfoodAisles.length; k++) {
  const x0 = nonfoodAisles[k] + HALF_AISLE;
  const w = NONFOOD_PITCH - 2 * HALF_AISLE;
  const [rear, near] = [NONFOOD[2 * k], NONFOOD[2 * k + 1]];
  block(rear[0], rear[1], rear[2], x0, REAR[0], w, REAR[1] - REAR[0], x0, STOP.rearRight, node(nonfoodAisles[k], STOP.rearRight, {}));
  block(near[0], near[1], near[2], x0, NEAR[0], w, NEAR[1] - NEAR[0], x0, STOP.frontRight, node(nonfoodAisles[k], STOP.frontRight, {}));
}

// Food gondolas: every aisle has a shelf on its left and on its right, each in two halves.
foodAisles.forEach((x, j) => {
  const [leftRear, leftFront, rightRear, rightFront] = SECTIONS.slice(4 * j, 4 * j + 4);
  const lx = x - HALF_AISLE - SHELF;
  const rx = x + HALF_AISLE;
  block(leftRear.id, leftRear.name, leftRear.kind, lx, REAR[0], SHELF, REAR[1] - REAR[0], x - HALF_AISLE, STOP.rearLeft, node(x, STOP.rearLeft, {}));
  block(rightRear.id, rightRear.name, rightRear.kind, rx, REAR[0], SHELF, REAR[1] - REAR[0], rx, STOP.rearRight, node(x, STOP.rearRight, {}));
  block(leftFront.id, leftFront.name, leftFront.kind, lx, NEAR[0], SHELF, NEAR[1] - NEAR[0], x - HALF_AISLE, STOP.frontLeft, node(x, STOP.frontLeft, {}));
  block(rightFront.id, rightFront.name, rightFront.kind, rx, NEAR[0], SHELF, NEAR[1] - NEAR[0], rx, STOP.frontRight, node(x, STOP.frontRight, {}));
});

// Service counters along the back wall of the food hall.
{
  const from = foodAisles[0] - HALF_AISLE - SHELF;
  const to = foodAisles[foodAisles.length - 1] + HALF_AISLE + SHELF;
  const w = (to - from) / COUNTERS.length;
  COUNTERS.forEach(([id, name, kind], i) => {
    const x0 = from + w * i;
    // served from the aisle end nearest to the middle of the counter
    const stopX = foodAisles.reduce((best, x) => (Math.abs(x - (x0 + w / 2)) < Math.abs(best - (x0 + w / 2)) ? x : best), foodAisles[0]);
    block(id, name, kind, x0, 0.3, w, 2, stopX, 2.3, node(stopX, BACK, {}));
  });
}

// Checkouts: a line between the front cross aisle and the mall.
{
  const x0 = foodAisles[1];
  const x1 = foodAisles[8];
  const stopX = foodAisles[5];
  const checkout = node(stopX, FRONT, { type: 'room', label: 'Checkout', room: 'checkout', qr: true });
  rooms.push({ id: 'checkout', name: 'Checkouts', short: 'Checkouts', kind: 'checkout', ...rect(x0, FRONT + 4.5, x1 - x0, 6), doors: [{ x: ux(stopX), y: uy(FRONT + 4.5), width: r1(12 / MPU) }], node: checkout.id });
}

// Links: along every aisle and along the three cross aisles.
for (const x of new Set(nodes.map((n) => r1(n.mx)))) {
  const line = nodes.filter((n) => r1(n.mx) === x && n.my >= BACK && n.my <= FRONT).sort((a, b) => a.my - b.my);
  if (aisles.some((a) => r1(a) === x)) for (let i = 0; i + 1 < line.length; i++) link(line[i], line[i + 1]);
}
for (const y of [BACK, MID, FRONT]) {
  const line = nodes.filter((n) => n.my === y).sort((a, b) => a.mx - b.mx);
  for (let i = 0; i + 1 < line.length; i++) link(line[i], line[i + 1]);
}

nodes.forEach((n, i) => {
  n.name = `C${String(i + 1).padStart(3, '0')}`;
});

/* ------------------------------------------------------------ real products */

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const products = [];
const seenCode = new Set();
const seenName = new Set();
for (const section of SECTIONS) {
  const found = (off.sections[section.id] || { products: [] }).products;
  let taken = 0;
  for (const p of found) {
    if (taken >= PER_SECTION) break;
    let name = clean(p.name);
    const brand = clean(p.brand);
    if (name.length < 3 || name.length > 70) continue;
    name = name.charAt(0).toUpperCase() + name.slice(1);
    const key = `${name.toLowerCase()}|${brand.toLowerCase()}`;
    if (seenCode.has(p.code) || seenName.has(key)) continue;
    seenCode.add(p.code);
    seenName.add(key);
    const product = { id: String(p.code), name, section: section.id };
    if (brand) product.brand = brand;
    if (clean(p.quantity)) product.quantity = clean(p.quantity);
    if (p.image) product.image = p.image;
    products.push(product);
    taken++;
  }
}
// "Often bought": the most scanned product of a few everyday sections.
const featured = ['milks', 'breads', 'eggs', 'coffees', 'pastas', 'waters', 'cheeses', 'yogurts']
  .map((id) => products.find((p) => p.section === id))
  .filter(Boolean)
  .map((p) => p.id);
products.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

/* -------------------------------------------------------------------- write */

const ordered = nodes.map((n) => {
  const out = { name: n.name, type: n.type, id: n.id, x: ux(n.mx), y: uy(n.my), floor: 0 };
  if (n.label) out.label = n.label;
  if (n.room) out.room = n.room;
  if (!n.qr) out.qr = false;
  out.path = n.path;
  return out;
});

const t = storeWay.tags;
const graph = {
  meta: {
    name: `Carrefour ${t.branch ? t.branch.replace(/^Hypermarché\s+/i, '') : ''}`.trim(),
    type: 'store',
    metersPerUnit: MPU,
    qrSize: 0.25,
    address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') + ', Montesson, France',
    attribution: '© OpenStreetMap contributors · Products: Open Food Facts · Aisle layout is illustrative',
    sources: { map: `https://www.openstreetmap.org/way/${storeWay.id}`, products: 'https://world.openfoodfacts.org', mapFetched: osm.fetched, productsFetched: off.fetched },
    featured,
    floors: [
      {
        id: 0,
        name: 'Sales floor',
        short: 'S',
        spoken: 'the sales floor',
        width: Math.ceil((maxX - minX) / MPU),
        height: Math.ceil((maxY - minY) / MPU),
        outlines,
        rooms,
      },
    ],
  },
  nodes: ordered,
  products,
};

const file = path.resolve(__dirname, '../src/db/carrefour-montesson.json');
fs.writeFileSync(file, JSON.stringify(graph) + '\n');
const area = Math.abs(storePoly.reduce((s, p, i) => (i + 1 < storePoly.length ? s + p[0] * storePoly[i + 1][1] - storePoly[i + 1][0] * p[1] : s), 0)) / 2;
console.log(
  `${graph.meta.name}: real outline ${Math.round(area)} m2, ${outlines.length} outlines, ${entrances.length} entrances; ` +
    `${ordered.length} nodes (${ordered.filter((n) => n.qr !== false).length} markers), ${rooms.length} sections, ${products.length} real products ` +
    `in ${new Set(products.map((p) => p.section)).size} sections; sheet ${graph.meta.floors[0].width} x ${graph.meta.floors[0].height} units`
);
