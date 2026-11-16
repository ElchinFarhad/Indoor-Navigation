/**
 * Generates venues-src/freshmart/demo/: the demo supermarket.
 *
 *   node scripts/build-supermarket.js            map.json (and the CSV files if they do not exist)
 *   node scripts/build-supermarket.js --reseed   also rewrite locations.csv and products.csv
 *
 * Location codes: A<aisle>-<bay>, bays counted from the back wall, odd numbers
 * on the left of the aisle and even on the right (A03-01 left rear, A03-02
 * right rear, A03-03 left front, A03-04 right front); B-<n> are the counters
 * along the back wall.
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
const { writeVenue } = require('./venue-out');

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

// Italian names (the app shows them when the phone is set to Italian).
const SECTION_IT = {
  fruit: 'Frutta', vegetables: 'Verdura', cereals: 'Colazione e cereali', coffee: 'Caffè e tè', pasta: 'Pasta e riso', canned: 'Conserve',
  sauces: 'Salse e oli', baking: 'Farine e spezie', snacks: 'Snack e patatine', sweets: 'Dolci e cioccolato', softdrinks: 'Bibite',
  water: 'Acqua e succhi', wine: 'Birra e vino', world: 'Cucina dal mondo', frozen: 'Surgelati', icecream: 'Gelati', baby: 'Infanzia',
  pets: 'Animali', cleaning: 'Pulizia casa', paper: 'Carta e fazzoletti', beauty: 'Salute e bellezza', hygiene: 'Igiene personale',
  milk: 'Latte e yogurt', cheese: 'Formaggi e uova', bakery: 'Panetteria', butcher: 'Macelleria', fish: 'Pescheria',
};
const PRODUCT_IT = {
  Apples: 'Mele', Bananas: 'Banane', Oranges: 'Arance', Lemons: 'Limoni', Grapes: 'Uva', Tomatoes: 'Pomodori', Potatoes: 'Patate',
  Onions: 'Cipolle', Carrots: 'Carote', Salad: 'Insalata', Cucumber: 'Cetrioli', 'Corn flakes': 'Corn flakes', Muesli: 'Muesli',
  Oats: "Fiocchi d'avena", Jam: 'Marmellata', Honey: 'Miele', Coffee: 'Caffè', Tea: 'Tè', Sugar: 'Zucchero', Spaghetti: 'Spaghetti',
  Penne: 'Penne', Rice: 'Riso', Couscous: 'Cous cous', 'Canned tomatoes': 'Pomodori pelati', Beans: 'Fagioli', Tuna: 'Tonno',
  Sweetcorn: 'Mais', 'Olive oil': "Olio d'oliva", 'Tomato sauce': 'Passata di pomodoro', Ketchup: 'Ketchup', Vinegar: 'Aceto',
  Mayonnaise: 'Maionese', Flour: 'Farina', Salt: 'Sale', 'Black pepper': 'Pepe nero', 'Baking powder': 'Lievito per dolci',
  Crisps: 'Patatine', Peanuts: 'Arachidi', Crackers: 'Cracker', Chocolate: 'Cioccolato', Biscuits: 'Biscotti',
  'Chewing gum': 'Gomme da masticare', Cola: 'Cola', Lemonade: 'Limonata', 'Iced tea': 'Tè freddo', 'Still water': 'Acqua naturale',
  'Sparkling water': 'Acqua frizzante', 'Orange juice': "Succo d'arancia", 'Apple juice': 'Succo di mela', Beer: 'Birra',
  'Red wine': 'Vino rosso', 'White wine': 'Vino bianco', 'Soy sauce': 'Salsa di soia', Noodles: 'Noodles', Tortillas: 'Tortillas',
  'Frozen pizza': 'Pizza surgelata', 'Frozen peas': 'Piselli surgelati', 'Fish fingers': 'Bastoncini di pesce',
  'Vanilla ice cream': 'Gelato alla vaniglia', 'Ice lollies': 'Ghiaccioli', Nappies: 'Pannolini', 'Baby food': 'Omogeneizzati',
  'Cat food': 'Cibo per gatti', 'Dog food': 'Cibo per cani', 'Washing-up liquid': 'Detersivo piatti',
  'Laundry detergent': 'Detersivo lavatrice', Sponges: 'Spugne', 'Bin bags': 'Sacchi spazzatura', 'Toilet paper': 'Carta igienica',
  'Kitchen roll': 'Carta da cucina', Tissues: 'Fazzoletti', Shampoo: 'Shampoo', 'Sun cream': 'Crema solare', Plasters: 'Cerotti',
  Toothpaste: 'Dentifricio', Soap: 'Sapone', Deodorant: 'Deodorante', Milk: 'Latte', Yoghurt: 'Yogurt', Butter: 'Burro', Cream: 'Panna',
  Mozzarella: 'Mozzarella', Parmesan: 'Parmigiano', Eggs: 'Uova', Bread: 'Pane', Croissants: 'Cornetti', 'Bread rolls': 'Panini',
  'Chicken breast': 'Petto di pollo', 'Minced beef': 'Macinato di manzo', Ham: 'Prosciutto', Sausages: 'Salsicce', Salmon: 'Salmone',
  Prawns: 'Gamberi',
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
function shelf(code, id, name, kind, x, y, w, h, faceX, faceY, stop) {
  Object.assign(stop, { type: 'room', label: name, room: id });
  rooms.push({ id, code, name, name_it: SECTION_IT[id], kind, solid: true, x, y, w, h, doors: [{ x: faceX, y: faceY }], node: stop.id });
}

// Entrance first, so it gets id 0.
const entrance = node(AISLES[0], 280, { type: 'room', label: 'Entrance', label_it: 'Ingresso', room: 'entrance', qr: true });
rooms.push({ id: 'entrance', name: 'Entrance', name_it: 'Ingresso', short: 'Entrance', short_it: 'Ingresso', kind: 'lobby', x: 20, y: 250, w: 60, h: 50, doors: [{ x: 40, y: 250, width: 40 }, { x: 40, y: 300, width: 24, entrance: true }], node: entrance.id });

// Cross aisles: a marker at both ends of every aisle.
AISLES.forEach((x, i) => {
  node(x, BACK, { label: `back of aisle ${i + 1}`, label_it: `fondo della corsia ${i + 1}`, qr: true });
  node(x, FRONT, { label: `front of aisle ${i + 1}`, label_it: `inizio della corsia ${i + 1}`, qr: true });
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
  const code = (bay) => `A${String(i + 1).padStart(2, '0')}-${String(bay).padStart(2, '0')}`;
  shelf(code(1), leftRear[0], leftRear[1], leftRear[2], leftX, rear[0], leftW, rear[1], leftX + leftW, STOP_Y.rearLeft, node(x, STOP_Y.rearLeft, {}));
  shelf(code(2), rightRear[0], rightRear[1], rightRear[2], rightX, rear[0], rightW, rear[1], rightX, STOP_Y.rearRight, node(x, STOP_Y.rearRight, {}));
  shelf(code(3), leftFront[0], leftFront[1], leftFront[2], leftX, front[0], leftW, front[1], leftX + leftW, STOP_Y.frontLeft, node(x, STOP_Y.frontLeft, {}));
  shelf(code(4), rightFront[0], rightFront[1], rightFront[2], rightX, front[0], rightW, front[1], rightX, STOP_Y.frontRight, node(x, STOP_Y.frontRight, {}));
});

// Service counters along the back wall, served from the back cross aisle.
shelf('B-01', 'bakery', 'Bakery', 'bakery', 20, 0, 116, 20, 104, 20, node(104, BACK, { qr: true }));
shelf('B-02', 'butcher', 'Butcher', 'meat', 136, 0, 128, 20, 232, 20, node(232, BACK, { qr: true }));
shelf('B-03', 'fish', 'Fish counter', 'fish', 264, 0, 136, 20, 296, 20, node(296, BACK, { qr: true }));

// Checkouts, off the front cross aisle.
const checkout = node(264, FRONT, { type: 'room', label: 'Checkout', label_it: 'Cassa', room: 'checkout', qr: true });
rooms.push({ id: 'checkout', name: 'Checkouts', name_it: 'Casse', short: 'Checkouts', short_it: 'Casse', kind: 'checkout', x: 150, y: 255, w: 240, h: 45, doors: [{ x: 264, y: 255, width: 60 }], node: checkout.id });

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
    products.push({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, name_it: PRODUCT_IT[name], section });
  }
}
products.sort((a, b) => a.name.localeCompare(b.name));

const ordered = nodes.map((n) => {
  const out = { name: n.name, type: n.type, id: n.id, x: n.x, y: n.y, floor: 0 };
  if (n.label) out.label = n.label;
  if (n.label_it) out.label_it = n.label_it;
  if (n.room) out.room = n.room;
  if (!n.qr) out.qr = false;
  out.path = n.path;
  return out;
});

const graph = {
  meta: {
    metersPerUnit: MPU,
    qrSize: 0.25,
    floors: [{ id: 0, name: 'Sales floor', name_it: 'Area vendita', short: 'S', spoken: 'the sales floor', spoken_it: 'piano vendita', width: WIDTH, height: HEIGHT, corridors: [{ id: 'floor', x: 20, y: 20, w: 380, h: 235 }], rooms }],
  },
  nodes: ordered,
  products,
};

const summary = `${ordered.length} nodes (${ordered.filter((n) => n.qr !== false).length} with a marker), ${rooms.length} sections, ${products.length} products`;
writeVenue({
  retailer: 'freshmart',
  storeId: 'demo',
  store: {
    id: 'supermarket',
    order: 2,
    name: 'FreshMart Supermarket',
    name_it: 'Supermercato FreshMart',
    retailer: { id: 'freshmart', name: 'FreshMart' },
    store: { id: 'demo', name: 'Demo store' },
    type: 'store',
    version: '2026-11-16',
    featured: ['milk', 'bread', 'eggs', 'apples', 'coffee', 'spaghetti', 'still-water', 'toilet-paper'],
  },
  graph,
  productColumns: ['id', 'name', 'name_it', 'location'],
});
console.log(`FreshMart: ${summary}`);
