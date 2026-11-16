/**
 * Venue data: from the editable sources to the files the app loads.
 *
 *   node scripts/venues.js build     compile every store into public/venues/
 *   node scripts/venues.js check     validate only, print the report
 *
 * Sources, one folder per store:
 *
 *   venues-src/<retailer>/<store>/
 *     store.json      who and what: ids, names, version, type, credit line
 *     map.json        the place: floors, shelf bays with their location codes,
 *                     the walkable graph, the QR markers. Changes rarely.
 *     locations.csv   what stands at each location code (a category) - stores only
 *     products.csv    which product is at which location code       - stores only
 *
 * A location code names a physical place ("A03-02": aisle 3, bay 2) and never
 * says what is there. Moving a category or a product is therefore one changed
 * line in a CSV file; the map is not touched.
 *
 * Output, loaded by the app at start-up:
 *
 *   public/venues/index.json                              the stores and their current version
 *   public/venues/<retailer>/<store>/<version>/map.json
 *   public/venues/<retailer>/<store>/<version>/catalog.json
 *
 * Text can be given in more languages with a suffix: name_it, label_it,
 * short_it, spoken_it (in JSON) and name_it (CSV column).
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../venues-src');
const OUT = path.resolve(__dirname, '../public/venues');

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r, n) => {
    const record = { _line: n + 2 };
    header.forEach((h, i) => {
      const value = (r[i] || '').trim();
      if (value !== '') record[h] = value;
    });
    return record;
  });
}

function toCsv(header, records) {
  const cell = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(',')].concat(records.map((r) => header.map((h) => cell(r[h])).join(','))).join('\n') + '\n';
}

const CODE = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/;

/** Reads and validates one store folder. Throws on errors that would break navigation. */
function compileStore(dir) {
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
  const has = (name) => fs.existsSync(path.join(dir, name));
  const errors = [];
  const warnings = [];

  const store = JSON.parse(read('store.json'));
  for (const key of ['id', 'name', 'version']) if (!store[key]) errors.push(`store.json: "${key}" is missing`);
  if (!store.retailer || !store.retailer.id) errors.push('store.json: "retailer.id" is missing');
  if (!store.store || !store.store.id) errors.push('store.json: "store.id" is missing');

  const map = JSON.parse(read('map.json'));
  const rooms = [];
  for (const floor of (map.meta && map.meta.floors) || []) for (const room of floor.rooms || []) rooms.push(room);
  const byCode = new Map();
  for (const room of rooms) {
    if (!room.code) continue;
    if (!CODE.test(room.code)) errors.push(`map.json: location code "${room.code}" is not of the form A03-02`);
    if (byCode.has(room.code)) errors.push(`map.json: location code "${room.code}" is used twice`);
    byCode.set(room.code, room);
  }
  const nodeIds = new Set(map.nodes.map((n) => n.id));
  for (const room of rooms) if (room.node !== undefined && !nodeIds.has(room.node)) errors.push(`map.json: room ${room.code || room.id} points to missing node ${room.node}`);

  const catalog = { locations: [], products: [] };
  const unlocated = [];
  if (has('locations.csv')) {
    const seenCode = new Set();
    const seenSection = new Map();
    for (const r of parseCsv(read('locations.csv'))) {
      const at = `locations.csv line ${r._line}`;
      if (!r.code || !r.name) {
        errors.push(`${at}: "code" and "name" are required`);
        continue;
      }
      if (!byCode.has(r.code)) {
        errors.push(`${at}: location code "${r.code}" is not on the map`);
        continue;
      }
      if (seenCode.has(r.code)) {
        errors.push(`${at}: location code "${r.code}" is listed twice`);
        continue;
      }
      seenCode.add(r.code);
      // The section id is what lists and links refer to; it stays the same when the section moves.
      let section = r.section || r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const n = (seenSection.get(section) || 0) + 1;
      seenSection.set(section, n);
      if (n > 1) section = `${section}@${r.code}`;
      const location = { code: r.code, section, name: r.name, kind: r.kind || 'pantry' };
      for (const key of Object.keys(r)) if (/^(name|short)_[a-z]{2}$/.test(key) || key === 'short') location[key] = r[key];
      catalog.locations.push(location);
    }
    for (const code of byCode.keys()) if (!seenCode.has(code)) warnings.push(`location ${code} is on the map but has nothing assigned`);

    if (has('products.csv')) {
      const seenId = new Set();
      for (const r of parseCsv(read('products.csv'))) {
        const at = `products.csv line ${r._line}`;
        if (!r.id || !r.name) {
          errors.push(`${at}: "id" and "name" are required`);
          continue;
        }
        if (seenId.has(r.id)) {
          errors.push(`${at}: product id "${r.id}" is listed twice`);
          continue;
        }
        seenId.add(r.id);
        // A product without a place, or at a place with nothing assigned, cannot be navigated to:
        // it is left out and reported, so that a nightly import never publishes a dead end.
        if (!r.location || !seenCode.has(r.location)) {
          unlocated.push({ id: r.id, name: r.name, location: r.location || '' });
          continue;
        }
        const product = { id: r.id, name: r.name, location: r.location };
        for (const key of ['brand', 'quantity', 'image']) if (r[key]) product[key] = r[key];
        for (const key of Object.keys(r)) if (/^name_[a-z]{2}$/.test(key)) product[key] = r[key];
        catalog.products.push(product);
      }
    }
  }
  for (const id of store.featured || []) if (!catalog.products.some((p) => p.id === id)) warnings.push(`featured product ${id} is not in products.csv`);

  if (errors.length > 0) {
    throw new Error(`${path.relative(SRC, dir)}:\n  ${errors.join('\n  ')}`);
  }
  const entry = {
    id: store.id,
    name: store.name,
    retailer: store.retailer,
    store: store.store,
    type: store.type === 'store' ? 'store' : 'building',
    version: store.version,
    path: `${store.retailer.id}/${store.store.id}/${store.version}`,
  };
  for (const key of Object.keys(store)) if (/^name_[a-z]{2}$/.test(key)) entry[key] = store[key];
  // Store-level facts travel with the map file.
  map.meta = Object.assign({}, map.meta, { name: store.name, type: entry.type });
  for (const key of ['address', 'attribution', 'featured', 'sources']) if (store[key]) map.meta[key] = store[key];
  for (const key of Object.keys(store)) if (/^(name|attribution)_[a-z]{2}$/.test(key)) map.meta[key] = store[key];
  return { entry, map, catalog, report: { warnings, unlocated, locations: catalog.locations.length, products: catalog.products.length } };
}

/** Folders that hold a store.json, in a stable order (store.json "order" first). */
function storeDirs(root = SRC) {
  const dirs = [];
  for (const retailer of fs.readdirSync(root).sort()) {
    const r = path.join(root, retailer);
    if (!fs.statSync(r).isDirectory()) continue;
    for (const store of fs.readdirSync(r).sort()) {
      const s = path.join(r, store);
      if (fs.statSync(s).isDirectory() && fs.existsSync(path.join(s, 'store.json'))) dirs.push(s);
    }
  }
  const order = (d) => JSON.parse(fs.readFileSync(path.join(d, 'store.json'), 'utf8')).order || 100;
  return dirs.sort((a, b) => order(a) - order(b));
}

function compileAll(root = SRC) {
  return storeDirs(root).map(compileStore);
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const compiled = compileAll();
  for (const v of compiled) {
    const dir = path.join(OUT, v.entry.path);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'map.json'), JSON.stringify(v.map));
    fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(v.catalog));
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ venues: compiled.map((v) => v.entry) }, null, 1) + '\n');
  return compiled;
}

function printReport(compiled) {
  for (const v of compiled) {
    const r = v.report;
    console.log(`${v.entry.path}: ${v.map.nodes.length} graph points, ${r.locations} locations, ${r.products} products`);
    for (const w of r.warnings) console.log(`  warning: ${w}`);
    if (r.unlocated.length > 0) {
      console.log(`  ${r.unlocated.length} product(s) left out because their location is unknown:`);
      for (const p of r.unlocated.slice(0, 10)) console.log(`    ${p.id} ${p.name} (${p.location || 'no location'})`);
    }
  }
}

if (require.main === module) {
  const command = process.argv[2] || 'build';
  try {
    printReport(command === 'check' ? compileAll() : build());
  } catch (err) {
    console.error(`Venue data is not valid:\n${err.message}`);
    process.exit(1);
  }
}

module.exports = { parseCsv, toCsv, compileStore, compileAll, storeDirs, build, SRC, OUT };
