/**
 * Shared by the demo generators (build-*.js): writes one store folder under
 * venues-src/ from a generated plan.
 *
 * The generator describes the place as before (rooms with names, products with
 * a section). This splits it into the three sources the app is built from:
 *
 *   map.json       shelf blocks keep only their location code
 *   locations.csv  code -> section (name, kind): what stands where
 *   products.csv   product -> code
 *
 * map.json is always rewritten. The two CSV files are the part people edit, so
 * they are only written when missing, or when the generator is run with
 * --reseed.
 */
const fs = require('fs');
const path = require('path');
const { toCsv, SRC } = require('./venues');

function writeVenue({ retailer, storeId, store, graph, productColumns }) {
  const dir = path.join(SRC, retailer, storeId);
  fs.mkdirSync(dir, { recursive: true });
  const reseed = process.argv.indexOf('--reseed') > 0;

  const codeOf = new Map(); // section id -> location code
  const locations = [];
  for (const floor of graph.meta.floors) {
    floor.rooms = floor.rooms.map((room) => {
      if (!room.code) return room;
      codeOf.set(room.id, room.code);
      const row = { code: room.code, section: room.id, kind: room.kind, name: room.name };
      for (const key of Object.keys(room)) if (/^name_[a-z]{2}$/.test(key)) row[key] = room[key];
      locations.push(row);
      const bare = { id: room.code, code: room.code, solid: room.solid, x: room.x, y: room.y, w: room.w, h: room.h, doors: room.doors, node: room.node };
      if (!bare.solid) delete bare.solid;
      return bare;
    });
  }
  // Stops in front of a shelf take their name from whatever is assigned to it.
  for (const node of graph.nodes) {
    if (node.room && codeOf.has(node.room)) {
      node.room = codeOf.get(node.room);
      delete node.label;
      for (const key of Object.keys(node)) if (/^label_[a-z]{2}$/.test(key)) delete node[key];
    }
  }
  const products = (graph.products || []).map((p) => Object.assign({}, p, { location: codeOf.get(p.section) || '' }));
  delete graph.products;
  // Store-level facts live in store.json.
  for (const key of ['name', 'type', 'address', 'attribution', 'featured', 'sources']) delete graph.meta[key];

  fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(graph, null, 1) + '\n');

  const storeFile = path.join(dir, 'store.json');
  const previous = fs.existsSync(storeFile) ? JSON.parse(fs.readFileSync(storeFile, 'utf8')) : {};
  // The version is bumped by hand (or by an import job) when data is published; a re-run keeps it.
  fs.writeFileSync(storeFile, JSON.stringify(Object.assign({}, store, previous.version ? { version: previous.version } : {}), null, 1) + '\n');

  const written = ['map.json', 'store.json'];
  if (locations.length > 0) {
    const locFile = path.join(dir, 'locations.csv');
    if (reseed || !fs.existsSync(locFile)) {
      const extra = Array.from(new Set(locations.flatMap((l) => Object.keys(l)))).filter((k) => /^name_[a-z]{2}$/.test(k));
      fs.writeFileSync(locFile, toCsv(['code', 'section', 'kind', 'name'].concat(extra), locations));
      written.push('locations.csv');
    }
    const prodFile = path.join(dir, 'products.csv');
    if (reseed || !fs.existsSync(prodFile)) {
      fs.writeFileSync(prodFile, toCsv(productColumns || ['id', 'name', 'location'], products));
      written.push('products.csv');
    }
  }
  console.log(`  ${path.relative(path.resolve(__dirname, '..'), dir)}: wrote ${written.join(', ')}`);
}

module.exports = { writeVenue };
