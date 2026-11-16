import fs from 'fs';
import os from 'os';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: a CommonJS build script without type declarations
import venues from '../../../scripts/venues.js';
import { assembleVenue } from '../assemble';
import { setLangForTests } from '../../i18n';
import { Building } from '../../nav/building';
import { compiled } from '../../test/venues';

const SOURCE = path.join(venues.SRC, 'freshmart', 'demo');

/** A private copy of the demo store's sources that a test may edit. */
function copyOfStore(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-'));
  for (const file of fs.readdirSync(SOURCE)) fs.copyFileSync(path.join(SOURCE, file), path.join(dir, file));
  return dir;
}

function editLine(file: string, startsWith: string, change: (line: string) => string) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith(startsWith));
  expect(i).toBeGreaterThan(0);
  lines[i] = change(lines[i]);
  fs.writeFileSync(file, lines.join('\n'));
}

const build = (dir: string) => {
  const v = venues.compileStore(dir);
  return { ...v, building: new Building(assembleVenue(v.map, v.catalog)) };
};

afterEach(() => setLangForTests('en'));

describe('venue sources', () => {
  it('reads CSV with quotes, commas and empty cells', () => {
    const rows = venues.parseCsv('id,name,brand\r\n1,"Olive oil, extra virgin","Monini ""Classico"""\n2,Salt,\n\n');
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe('Olive oil, extra virgin');
    expect(rows[0].brand).toBe('Monini "Classico"');
    expect(rows[1].brand).toBeUndefined();
  });

  it('publishes every store as retailer / store / version', () => {
    expect(compiled.map((c) => c.entry.id)).toEqual(['engineering', 'supermarket', 'carrefour']);
    const market = compiled.find((c) => c.entry.id === 'supermarket')!.entry;
    expect(market.retailer.id).toBe('freshmart');
    expect(market.path).toBe(`freshmart/demo/${market.version}`);
  });

  it('gives every shelf bay a location code that says where, not what', () => {
    const market = compiled.find((c) => c.entry.id === 'supermarket')!;
    const coded = market.map.meta.floors[0].rooms.filter((r: any) => r.code);
    expect(coded.length).toBe(27);
    for (const room of coded) {
      expect(room.code).toMatch(/^(A\d\d-\d\d|B-\d\d)$/);
      // the map knows the place only: no section name, no kind
      expect(room.name).toBeUndefined();
      expect(room.kind).toBeUndefined();
    }
    const milk = new Building(assembleVenue(market.map, market.catalog)).product('milk')!;
    expect(milk.code).toBe('A06-02');
    expect(milk.section.name).toBe('Milk & yoghurt');
  });
});

describe('changing data without touching the map', () => {
  it('moves a product by editing one line of products.csv', () => {
    const dir = copyOfStore();
    const before = build(dir).building.product('milk')!;
    expect(before.section.id).toBe('milk');
    const map = fs.readFileSync(path.join(dir, 'map.json'), 'utf8');

    editLine(path.join(dir, 'products.csv'), 'milk,', (line) => line.replace('A06-02', 'A01-01'));
    const after = build(dir).building.product('milk')!;
    expect(after.code).toBe('A01-01');
    expect(after.section.id).toBe('fruit');
    expect(after.nodeId).not.toBe(before.nodeId);
    expect(fs.readFileSync(path.join(dir, 'map.json'), 'utf8')).toBe(map);
  });

  it('moves a whole section by swapping two lines of locations.csv', () => {
    const dir = copyOfStore();
    const file = path.join(dir, 'locations.csv');
    const original = build(dir).building;
    const pastaNode = original.rooms().find((r) => r.roomId === 'pasta')!.id;
    const snacksNode = original.rooms().find((r) => r.roomId === 'snacks')!.id;
    const pastaCode = original.roomOf(original.node(pastaNode)!)!.code!;
    const snacksCode = original.roomOf(original.node(snacksNode)!)!.code!;
    editLine(file, `${pastaCode},`, (line) => line.replace(pastaCode, 'TEMP'));
    editLine(file, `${snacksCode},`, (line) => line.replace(snacksCode, pastaCode));
    editLine(file, 'TEMP,', (line) => line.replace('TEMP', snacksCode));

    const swapped = build(dir).building;
    // the sections keep their ids (lists and links still work) and stand where the other one was
    expect(swapped.rooms().find((r) => r.roomId === 'pasta')!.id).toBe(snacksNode);
    expect(swapped.rooms().find((r) => r.roomId === 'snacks')!.id).toBe(pastaNode);
    expect(swapped.node(snacksNode)!.label).toBe('Pasta & rice');
  });

  it('leaves out and reports a product whose location is unknown, instead of publishing a dead end', () => {
    const dir = copyOfStore();
    editLine(path.join(dir, 'products.csv'), 'milk,', (line) => line.replace('A06-02', 'A99-01'));
    const v = build(dir);
    expect(v.building.product('milk')).toBeUndefined();
    expect(v.report.unlocated).toEqual([{ id: 'milk', name: 'Milk', location: 'A99-01' }]);
    expect(v.building.products.length).toBe(92);
  });

  it('refuses data that would break the store: unknown or duplicate location codes', () => {
    const unknown = copyOfStore();
    editLine(path.join(unknown, 'locations.csv'), 'A01-01,', (line) => line.replace('A01-01', 'Z09-01'));
    expect(() => venues.compileStore(unknown)).toThrow(/location code "Z09-01" is not on the map/);

    const twice = copyOfStore();
    editLine(path.join(twice, 'locations.csv'), 'A01-02,', (line) => line.replace('A01-02', 'A01-01'));
    expect(() => venues.compileStore(twice)).toThrow(/"A01-01" is listed twice/);
  });

  it('keeps a bay with nothing assigned on the map, but not as a destination', () => {
    const dir = copyOfStore();
    const file = path.join(dir, 'locations.csv');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.startsWith('A01-01,')).join('\n'));
    const v = build(dir);
    expect(v.report.warnings).toContain('location A01-01 is on the map but has nothing assigned');
    expect(v.building.rooms().some((r) => r.roomId === 'A01-01' || r.roomId === 'fruit')).toBe(false);
    expect(v.building.floors[0].rooms.some((r) => r.code === 'A01-01' && r.kind === 'empty')).toBe(true);
    expect(v.building.product('apples')).toBeUndefined();
  });
});

describe('languages in venue data', () => {
  it('shows Italian names when the language is Italian, with the same ids', () => {
    const market = compiled.find((c) => c.entry.id === 'supermarket')!;
    setLangForTests('it');
    const store = new Building(assembleVenue(market.map, market.catalog));
    expect(store.name).toBe('Supermercato FreshMart');
    expect(store.product('milk')!.name).toBe('Latte');
    expect(store.product('milk')!.section.name).toBe('Latte e yogurt');
    expect(store.rooms().find((r) => r.roomId === 'checkout')!.label).toBe('Cassa');
    expect(store.floors[0].spoken).toBe('piano vendita');
  });

  it('falls back to the base text where no translation is given', () => {
    const carrefour = compiled.find((c) => c.entry.id === 'carrefour')!;
    setLangForTests('it');
    const store = new Building(assembleVenue(carrefour.map, carrefour.catalog));
    // sections are translated, product names stay as printed on the pack
    expect(store.products.some((p) => p.section.name === 'Latte')).toBe(true);
    expect(store.products.find((p) => p.section.id === 'milks')!.name).toMatch(/lait/i);
  });
});
