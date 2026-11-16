/**
 * Downloads the real-world data behind the "Carrefour Montesson" venue and
 * stores it as snapshots in scripts/data/carrefour-montesson/, so that
 * build-carrefour.js works offline and gives the same result every time.
 *
 *   node scripts/fetch-carrefour-data.js            # everything
 *   node scripts/fetch-carrefour-data.js osm        # only the map
 *   node scripts/fetch-carrefour-data.js products   # only the products
 *
 * Sources (both open data, both need attribution, see docs/REAL-DATA.md):
 *  - OpenStreetMap (ODbL): the Montesson shopping centre is mapped indoors:
 *    the outline of the Carrefour hypermarket, the other shops, the entrances.
 *  - Open Food Facts (ODbL): products that contributors recorded as sold at
 *    Carrefour in France, by category, most scanned first.
 *
 * Uses curl so that a proxy from the environment is honoured. The Open Food
 * Facts search API allows 10 requests a minute: the script waits in between.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = path.resolve(__dirname, 'data/carrefour-montesson');
const UA = 'indoor-navigation-demo/1.0 (open-source thesis project; build script)';

/** Bounding box of the shopping centre: west, south, east, north. */
const BBOX = [2.1436, 48.9268, 2.1471, 48.9291];
/** OSM way of the hypermarket's sales floor. */
const STORE_WAY = 221944925;

/**
 * Shelf sections of the food hall and the Open Food Facts categories that
 * fill them (the first category with enough products wins).
 */
const SECTIONS = require('./carrefour-sections');

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function get(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const body = execFileSync('curl', ['-sS', '--fail', '-m', '60', '-A', UA, '-H', 'Accept: application/json', url], { maxBuffer: 64 * 1024 * 1024 });
      return JSON.parse(body.toString('utf8'));
    } catch (err) {
      if (i >= tries) throw err;
      sleep(20000 * i);
    }
  }
}

function fetchOsm() {
  const map = get(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${BBOX.join(',')}`);
  const nodes = new Map();
  const ways = [];
  for (const e of map.elements) {
    if (e.type === 'node') nodes.set(e.id, e);
  }
  // Keep what the plan is drawn from: indoor rooms, the mall building, entrances.
  const keepNode = new Set();
  for (const e of map.elements) {
    if (e.type !== 'way' || !e.tags) continue;
    const t = e.tags;
    const wanted = t.indoor === 'room' || t.indoor === 'corridor' || t.shop === 'mall';
    if (!wanted) continue;
    if ((t.level || '0').split(';').indexOf('0') < 0) continue;
    ways.push({ id: e.id, nodes: e.nodes, tags: t });
    e.nodes.forEach((id) => keepNode.add(id));
  }
  const points = [];
  for (const [id, n] of nodes) {
    const t = n.tags || {};
    const poi = t.entrance && (t.level || '0') === '0';
    if (keepNode.has(id) || poi) points.push({ id, lat: n.lat, lon: n.lon, tags: n.tags });
  }
  const out = {
    source: 'OpenStreetMap, © OpenStreetMap contributors, ODbL 1.0',
    fetched: new Date().toISOString().slice(0, 10),
    bbox: BBOX,
    storeWay: STORE_WAY,
    nodes: points,
    ways,
  };
  fs.writeFileSync(path.join(OUT, 'osm.json'), JSON.stringify(out) + '\n');
  console.log(`osm.json: ${ways.length} ways, ${points.length} nodes`);
}

function fetchProducts() {
  const fields = 'code,product_name,product_name_fr,brands,quantity,categories_tags,image_front_small_url,unique_scans_n';
  // Saved after every section, and sections that are already there are kept:
  // the API often answers 503 under load, so a run can be repeated until complete.
  const file = path.join(OUT, 'off-products.json');
  const fresh = process.argv.indexOf('--fresh') > 0;
  const sections = !fresh && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).sections : {};
  const save = () => {
    const out = {
      source: 'Open Food Facts, https://world.openfoodfacts.org, ODbL 1.0; product images CC BY-SA',
      query: 'stores_tags=carrefour, countries=france, sorted by number of scans',
      fetched: new Date().toISOString().slice(0, 10),
      sections,
    };
    fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  };
  let requests = 0;
  for (const section of SECTIONS) {
    if (sections[section.id] && sections[section.id].products.length >= 6) continue;
    let found = [];
    let used = null;
    for (const category of section.categories) {
      if (requests++ > 0) sleep(9000);
      const url =
        'https://world.openfoodfacts.org/api/v2/search?stores_tags=carrefour&countries_tags_en=france' +
        `&categories_tags_en=${encodeURIComponent(category)}&fields=${fields}&page_size=30&sort_by=unique_scans_n`;
      let products = [];
      try {
        products = get(url).products || [];
      } catch (err) {
        console.log(`  ${section.id}: ${category} failed (${String(err.message).split('\n')[0]})`);
      }
      const usable = products.filter((p) => (p.product_name_fr || p.product_name || '').trim().length > 2 && p.code);
      if (usable.length > found.length) {
        found = usable;
        used = category;
      }
      if (found.length >= 6) break;
    }
    sections[section.id] = {
      category: used,
      products: found.slice(0, 20).map((p) => ({
        code: p.code,
        name: (p.product_name_fr || p.product_name).trim(),
        brand: (p.brands || '').split(',')[0].trim(),
        quantity: (p.quantity || '').trim(),
        image: p.image_front_small_url || '',
        scans: p.unique_scans_n || 0,
      })),
    };
    save();
    console.log(`  ${section.id}: ${found.length} products (${used})`);
  }
  save();
  const complete = SECTIONS.filter((x) => sections[x.id] && sections[x.id].products.length >= 6).length;
  console.log(`off-products.json: ${complete} of ${SECTIONS.length} sections have 6 or more products`);
}

fs.mkdirSync(OUT, { recursive: true });
const what = process.argv[2] || 'all';
if (what === 'all' || what === 'osm') fetchOsm();
if (what === 'all' || what === 'products') fetchProducts();
