import fs from 'fs';
import path from 'path';
import it_ from '../it';
import { plural, setLangForTests, t } from '../index';
import { CATEGORY_ORDER } from '../../map/plan';
import { Announcer } from '../../nav/announcer';
import { Building } from '../../nav/building';
import { buildManeuvers, guidanceAt } from '../../nav/instructions';
import { NavigationSession } from '../../nav/navigator';
import { findRoute } from '../../nav/routing';
import { venueGraph } from '../../test/venues';

/** Every literal text passed to t() or plural() in the source files. */
function textsInCode(): string[] {
  const found = new Set<string>();
  const str = `'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)"`;
  const single = new RegExp(`\\bt\\(\\s*(?:${str})`, 'g');
  const pair = new RegExp(`\\bplural\\(\\s*[^,]+,\\s*(?:${str})\\s*,\\s*(?:${str})`, 'g');
  const clean = (x: string) => x.replace(/\\(['"\\])/g, '$1');
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) {
        if (name !== '__tests__' && name !== 'i18n' && name !== 'test') walk(file);
      } else if (/\.tsx?$/.test(name)) {
        const source = fs.readFileSync(file, 'utf8');
        for (const m of source.matchAll(single)) found.add(clean(m[1] !== undefined ? m[1] : m[2]));
        for (const m of source.matchAll(pair)) {
          found.add(clean(m[1] !== undefined ? m[1] : m[2]));
          found.add(clean(m[3] !== undefined ? m[3] : m[4]));
        }
      }
    }
  };
  walk(path.resolve(__dirname, '../..'));
  return Array.from(found);
}

afterEach(() => setLangForTests('en'));

describe('translations', () => {
  it('has an Italian text for everything the interface says', () => {
    const used = textsInCode();
    expect(used.length).toBeGreaterThan(250);
    const missing = used.concat(CATEGORY_ORDER, ['All']).filter((text) => !it_[text]);
    expect(missing).toEqual([]);
  });

  it('keeps every placeholder of the English text in the Italian one', () => {
    const broken: string[] = [];
    for (const key of Object.keys(it_)) {
      const names = (s: string) => (s.match(/\{[a-z]+\}/g) || []).sort().join(',');
      if (names(key) !== names(it_[key])) broken.push(key);
    }
    expect(broken).toEqual([]);
  });

  it('returns English unchanged, fills in values and picks the plural', () => {
    expect(t('In {distance}, {action}', { distance: '6 m', action: 'turn left' })).toBe('In 6 m, turn left');
    expect(plural(1, '{n} item', '{n} items')).toBe('1 item');
    setLangForTests('it');
    expect(t('In {distance}, {action}', { distance: '6 m', action: 'gira a sinistra' })).toBe('Tra 6 m, gira a sinistra');
    expect(plural(3, '{n} item', '{n} items')).toBe('3 prodotti');
    expect(t('A text nobody translated')).toBe('A text nobody translated');
  });
});

describe('guidance in Italian', () => {
  it('writes and speaks the route in Italian, with Italian place names', () => {
    setLangForTests('it');
    const building = new Building(venueGraph('engineering'));
    const from = building.rooms().find((r) => r.roomId === 'lobby')!;
    const to = building.rooms().find((r) => r.roomId === 'cafe')!;
    expect(to.label).toBe('Bar');
    const route = findRoute(building, { nodeId: from.id }, to.id)!;
    const maneuvers = buildManeuvers(building, route);
    expect(maneuvers[maneuvers.length - 1].text).toBe('Arrivo: Bar');
    expect(guidanceAt(maneuvers, 0)!.headline).toMatch(/^Tra \d+ m, gira a (destra|sinistra)$/);

    const session = new NavigationSession(building, to.id, { now: () => 0 });
    const announcer = new Announcer(building);
    const spoken: string[] = [];
    session.subscribe((snapshot, event) => {
      for (const cue of announcer.update(snapshot, event)) if (cue.text) spoken.push(cue.text);
    });
    session.setStart(from.id);
    expect(spoken[0]).toMatch(/^Inizio la navigazione verso Bar\. Tra circa \d+ metri, gira a (destra|sinistra), presso atrio\.$/);
  });

  it('names the floor correctly when the route changes floor', () => {
    setLangForTests('it');
    const building = new Building(venueGraph('engineering'));
    const from = building.rooms().find((r) => r.roomId === 'lobby')!;
    const to = building.rooms().find((r) => r.floor === 1 && /^Laboratorio/.test(r.label || ''))!;
    const route = findRoute(building, { nodeId: from.id }, to.id, { avoidStairs: true })!;
    const lift = buildManeuvers(building, route).find((m) => m.type === 'elevator-up')!;
    expect(lift.text).toBe('Sali con l’ascensore');
    expect(lift.detail).toBe('fino al Primo piano');
  });
});
