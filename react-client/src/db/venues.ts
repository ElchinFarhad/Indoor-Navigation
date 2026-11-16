/**
 * The venues of this installation: retailer -> store -> version.
 *
 * Venue data is not part of the app bundle. At start-up the app reads
 * `venues/index.json` (which stores exist and which version of each is
 * current), then the map and the catalog of the chosen store. Publishing new
 * data, or going back to an older version, is a change of files on the server:
 * the app itself is not rebuilt. See scripts/venues.js and docs/VENUE-DATA.md.
 *
 * The venue is chosen with `?venue=<id>` in the address (remembered
 * afterwards) or with the selector on the home screen. Changing it reloads
 * the page, so the rest of the app can treat the building as a constant.
 */
import { BASE_PATH } from '../base';
import { localized } from '../i18n';
import { RawGraph } from '../nav/building';
import { assembleVenue } from './assemble';

export interface VenueEntry {
  id: string;
  name: string;
  retailer: { id: string; name: string };
  store: { id: string; name: string };
  type: string;
  version: string;
  /** Folder of this version below venues/. */
  path: string;
}

export interface Venue extends VenueEntry {
  graph: RawGraph;
}

const KEY = 'indoor-nav.venue';

/** Every venue of the installation, for the selector. */
export let VENUES: VenueEntry[] = [];
let loaded: Venue | null = null;

function chosenId(entries: VenueEntry[]): string {
  let id: string | null = null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('venue');
    if (fromUrl && entries.some((v) => v.id === fromUrl)) {
      window.localStorage.setItem(KEY, fromUrl);
      id = fromUrl;
    } else {
      id = window.localStorage.getItem(KEY);
    }
  } catch {
    /* no window / private mode: fall through to the default */
  }
  return entries.some((v) => v.id === id) ? id! : entries[0].id;
}

function withNames(entries: VenueEntry[]): VenueEntry[] {
  return entries.map((e) => ({ ...e, name: localized(e, 'name') || e.name }));
}

async function getJson(url: string, fresh: boolean): Promise<any> {
  const response = await fetch(url, fresh ? { cache: 'no-cache' } : undefined);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

/** Loads the list of venues and the data of the chosen one. Called once, before the app renders. */
export async function loadVenue(): Promise<Venue> {
  const root = `${BASE_PATH}/venues`;
  // The index is small and says which version is current: always ask the server.
  // A version's files never change, so the browser may keep them.
  const index = await getJson(`${root}/index.json`, true);
  const entries: VenueEntry[] = index.venues || [];
  if (entries.length === 0) throw new Error('No venue is published');
  const entry = entries.find((v) => v.id === chosenId(entries))!;
  const [map, catalog] = await Promise.all([
    getJson(`${root}/${entry.path}/map.json`, false),
    entry.type === 'store' ? getJson(`${root}/${entry.path}/catalog.json`, false) : Promise.resolve(null),
  ]);
  VENUES = withNames(entries);
  loaded = { ...VENUES.find((v) => v.id === entry.id)!, graph: assembleVenue(map, catalog) };
  return loaded;
}

/**
 * For tests and tools: provide compiled venues directly (the output of
 * scripts/venues.js) instead of fetching them. The current venue is then
 * picked from the address like in the browser.
 */
export function primeVenues(compiled: { entry: VenueEntry; map: any; catalog: any }[]) {
  const entries = withNames(compiled.map((c) => c.entry));
  VENUES = entries;
  const id = chosenId(entries);
  const chosen = compiled.find((c) => c.entry.id === id)!;
  loaded = { ...entries.find((v) => v.id === id)!, graph: assembleVenue(chosen.map, chosen.catalog) };
}

export function currentVenue(): Venue {
  if (!loaded) throw new Error('The venue is not loaded yet');
  return loaded;
}

/** Switches to another venue and reloads the app on its start page. */
export function selectVenue(id: string) {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* private mode: the address parameter below still carries the choice */
  }
  window.location.assign(`${BASE_PATH}/?venue=${encodeURIComponent(id)}`);
}
