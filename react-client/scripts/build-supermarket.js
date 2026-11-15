/**
 * Generates src/db/supermarket.json: the demo supermarket.
 *
 *   node scripts/build-supermarket.js
 *
 * A 42 m x 30 m sales floor: fresh departments along the walls, five double
 * sided gondolas with six aisles between them, a back and a front cross aisle,
 * entrance bottom left, checkouts bottom right. Each shelf section is a
 * destination with a point in the aisle in front of it; QR markers are only
 * laid at the aisle ends and the entrance (13 in total), because between them
 * the position is tracked with the motion sensors. Products are mapped to
 * shelf sections. A designed layout, not a survey of an existing shop.
 *
 * Units: decimetres (meta.metersPerUnit = 0.1), origin top left.
 */
const fs = require('fs');
const path = require('path');

const MPU = 0.1;
const WIDTH = 420, HEIGHT = 300;
const BACK = 35, FRONT = 235; // centre lines of the cross aisles
const AISLES = [40, 104, 168, 232, 296, 370]; // centre lines of aisles 1..6
const SHELF_TOP = 60, SHELF_MID = 135, SHELF_BOTTOM = 210;
// Stops in an aisle: the left shelf and the right shelf of each half get their own point.
const STOP_Y = { rearLeft: 90, rearRight: 105, frontLeft: 165, frontRight: 180 };

// [left rear, left front, right rear, right front] of every aisle: [id, name, kind]
const SECTIONS = [
  [['fruit', 'Fruit', 'produce'], ['vegetables', 'Vegetables', 'produce'], ['cereals', 'Breakfast & cereals', 'pantry'], ['coffee', 'Coffee & tea', 'pantry']],
  [['pasta', 'Pasta & rice', 'pantry'], ['canned', 'Canned food', 'pantry'], ['sauces', 'Sauces & oils', 'pantry'], ['baking', 'Baking & spices', 'pantry']],
  [['snacks', 'Snacks & crisps', 'snacks'], ['sweets', 'Sweets & chocolate', 'snacks'], ['softdrinks', 'Soft drinks', 'drinks'], ['water', 'Water & juice', 'drinks']],
  [['wine', 'Beer & wine', 'drinks'], ['world', 'World food', 'pantry'], ['frozen', 'Frozen food', 'frozen'], ['icecream', 'Ice cream', 'frozen']],
  [['baby', 'Baby', 'care'], ['pets', 'Pet food', 'household'], ['cleaning', 'Cleaning', 'household'], ['paper', 'Paper & tissues', 'household']],
  [['beauty', 'Health & beauty', 'care'], ['hygiene', 'Personal care', 'care'], ['milk', 'Milk & yoghurt', 'dairy'], ['cheese', 'Cheese & eggs', 'dairy']],
];

// name -> section id
const PRODUCTS = {
  fruit: ['Apples', 'Bananas', 'Oranges', 'Lemons', 'Grapes'],
  vegetables: ['Tomatoes', 'Potatoes', 'Onions', 'Carrots', 'Salad', 'Cucumber'],
  cereals: ['Corn flakes', 'Muesli', 'Oats', 'Jam', 'Honey'],
  coffee: ['Coffee', 'Tea', 'Sugar'],
  pasta: ['Spaghetti', 'Penne', 'Rice', 'Couscous'],
  canned: ['Canned tomatoes', 'Beans', 'Tuna', 'Sweetcorn'],
  sauces: ['Olive oil', 'Tomato sauce', 'Ketchup', 'Vinegar', 'Mayonnaise'],
  baking: ['Flour', 'Salt', 'Black pepper', 'Baking powder'],
  snacks: ['Crisps', 'Peanuts', 'Crackers'],
  sweets: ['Chocolate', 'Biscuits', 'Chewing gum'],
  softdrinks: ['Cola', 'Lemonade', 'Iced tea'],
  water: ['Still water', 'Sparkling water', 'Orange juice', 'Apple juice'],
  wine: ['Beer', 'Red wine', 'White wine'],
  world: ['Soy sauce', 'Noodles', 'Tortillas'],
  frozen: ['Frozen pizza', 'Frozen peas', 'Fish fingers'],
  icecream: ['Vanilla ice cream', 'Ice lollies'],
  baby: ['Nappies', 'Baby food'],
  pets: ['Cat food', 'Dog food'],
  cleaning: ['Washing-up liquid', 'Laundry detergent', 'Sponges', 'Bin bags'],
  paper: ['Toilet paper', 'Kitchen roll', 'Tissues'],
  beauty: ['Shampoo', 'Sun cream', 'Plasters'],
  hygiene: ['Toothpaste', 'Soap', 'Deodorant'],
  milk: ['Milk', 'Yoghurt', 'Butter', 'Cream'],
  cheese: ['Mozzarella', 'Parmesan', 'Eggs'],
  bakery: ['Bread', 'Croissants', 'Bread rolls'],
  butcher: ['Chicken breast', 'Minced beef', 'Ham', 'Sausages'],
  fish: ['Salmon', 'Prawns'],
};

const nodes = [];
const rooms = [];
const at = new Map();

function node(x, y, props) {
  const key = `${x}:${y}`;
  let n = at.get(key);
  if (!n) {
    n = { name: '', type: 'node', id: nodes.length, x, y, floor: 0, qr: false, path: [] };
    nodes.push(n);
    at.set(key, n);
  }
  Object.assign(n, props);
  return n;
}

function link(a, b) {
  const weight = Math.round(Math.hypot(a.x - b.x, a.y - b.y) * MPU * 10) / 10;
  a.path.push({ nodeID: b.id, weight });
  b.path.push({ nodeID: a.id, weight });
}

/** A shelf section: a solid block with one "face" (given as a door) towards its aisle. */
function shelf(id, name, kind, x, y, w, h, faceX, faceY, stop) {
  Object.assign(stop, { type: 'room', label: name, room: id });
  rooms.push({ id, name, short: name, kind, solid: true, x, y, w, h, doors: [{ x: faceX, y: faceY }], node: stop.id });
}

// Entrance first, so it gets id 0.
const entrance = node(AISLES[0], 280, { type: 'room', label: 'Entrance', room: 'entrance', qr: true });
rooms.push({ id: 'entrance', name: 'Entrance', short: 'Entrance', kind: 'lobby', x: 20, y: 250, w: 60, h: 50, doors: [{ x: 40, y: 250, width: 40 }, { x: 40, y: 300, width: 24, entrance: true }], node: entrance.id });

// Cross aisles: a marker at both ends of every aisle.
AISLES.forEach((x, i) => {
  node(x, BACK, { label: `back of aisle ${i + 1}`, qr: true });
  node(x, FRONT, { label: `front of aisle ${i + 1}`, qr: true });
});

// Shelves and the stops in front of them.
AISLES.forEach((x, i) => {
  const [leftRear, leftFront, rightRear, rightFront] = SECTIONS[i];
  // The shelf to the left of aisle i is the wall (aisle 1) or the right face of a gondola; likewise on the right.
  const leftX = i === 0 ? 0 : 72 + 64 * (i - 1);
  const leftW = i === 0 ? 20 : 12;
  const rightX = i === AISLES.length - 1 ? 400 : 60 + 64 * i;
  const rightW = i === AISLES.length - 1 ? 20 : 12;
  const rear = [SHELF_TOP, SHELF_MID - SHELF_TOP];
  const front = [SHELF_MID, SHELF_BOTTOM - SHELF_MID];
  shelf(leftRear[0], leftRear[1], leftRear[2], leftX, rear[0], leftW, rear[1], leftX + leftW, STOP_Y.rearLeft, node(x, STOP_Y.rearLeft, {}));
  shelf(rightRear[0], rightRear[1], rightRear[2], rightX, rear[0], rightW, rear[1], rightX, STOP_Y.rearRight, node(x, STOP_Y.rearRight, {}));
  shelf(leftFront[0], leftFront[1], leftFront[2], leftX, front[0], leftW, front[1], leftX + leftW, STOP_Y.frontLeft, node(x, STOP_Y.frontLeft, {}));
  shelf(rightFront[0], rightFront[1], rightFront[2], rightX, front[0], rightW, front[1], rightX, STOP_Y.frontRight, node(x, STOP_Y.frontRight, {}));
});

// Service counters along the back wall, served from the back cross aisle.
shelf('bakery', 'Bakery', 'bakery', 20, 0, 116, 20, 104, 20, node(104, BACK, { qr: true }));
shelf('butcher', 'Butcher', 'meat', 136, 0, 128, 20, 232, 20, node(232, BACK, { qr: true }));
shelf('fish', 'Fish counter', 'fish', 264, 0, 136, 20, 296, 20, node(296, BACK, { qr: true }));

// Checkouts, off the front cross aisle.
const checkout = node(264, FRONT, { type: 'room', label: 'Checkout', room: 'checkout', qr: true });
rooms.push({ id: 'checkout', name: 'Checkouts', short: 'Checkouts', kind: 'checkout', x: 150, y: 255, w: 240, h: 45, doors: [{ x: 264, y: 255, width: 60 }], node: checkout.id });

// Links: along every aisle, along both cross aisles, and from the entrance.
AISLES.forEach((x) => {
  const line = nodes.filter((n) => n.x === x && n.y >= BACK && n.y <= FRONT).sort((a, b) => a.y - b.y);
  for (let i = 0; i + 1 < line.length; i++) link(line[i], line[i + 1]);
});
for (const y of [BACK, FRONT]) {
  const line = nodes.filter((n) => n.y === y).sort((a, b) => a.x - b.x);
  for (let i = 0; i + 1 < line.length; i++) link(line[i], line[i + 1]);
}
link(entrance, at.get(`${AISLES[0]}:${FRONT}`));

nodes.forEach((n, i) => {
  n.name = `S${String(i + 1).padStart(2, '0')}`;
});

const products = [];
for (const section of Object.keys(PRODUCTS)) {
  for (const name of PRODUCTS[section]) {
    products.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, section });
  }
}
products.sort((a, b) => a.name.localeCompare(b.name));

const ordered = nodes.map((n) => {
  const out = { name: n.name, type: n.type, id: n.id, x: n.x, y: n.y, floor: 0 };
  if (n.label) out.label = n.label;
  if (n.room) out.room = n.room;
  if (!n.qr) out.qr = false;
  out.path = n.path;
  return out;
});

const graph = {
  meta: {
    name: 'FreshMart Supermarket',
    type: 'store',
    metersPerUnit: MPU,
    qrSize: 0.25,
    floors: [{ id: 0, name: 'Sales floor', short: 'S', spoken: 'the sales floor', width: WIDTH, height: HEIGHT, corridors: [{ id: 'floor', x: 20, y: 20, w: 380, h: 235 }], rooms }],
  },
  nodes: ordered,
  products,
};

const file = path.resolve(__dirname, '../src/db/supermarket.json');
fs.writeFileSync(file, JSON.stringify(graph, null, 1) + '\n');
console.log(`Wrote ${ordered.length} nodes (${ordered.filter((n) => n.qr !== false).length} with a marker), ${rooms.length} sections, ${products.length} products`);
