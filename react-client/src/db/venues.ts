/**
 * The venues this installation knows. Each is one JSON "database": a graph of
 * markers, a floor plan and, for a store, a product catalogue.
 *
 * The venue is chosen with `?venue=<id>` in the address (remembered
 * afterwards) or with the switcher in the top bar. Changing it reloads the
 * page, so the rest of the app can treat the building as a constant.
 */
import graph from './graph.json';
import supermarket from './supermarket.json';

export interface Venue {
  id: string;
  name: string;
  graph: any;
}

export const VENUES: Venue[] = [
  { id: 'engineering', name: 'Engineering Building', graph },
  { id: 'supermarket', name: 'FreshMart Supermarket', graph: supermarket },
];

const KEY = 'indoor-nav.venue';

export function currentVenue(): Venue {
  let id: string | null = null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('venue');
    if (fromUrl && VENUES.some((v) => v.id === fromUrl)) {
      window.localStorage.setItem(KEY, fromUrl);
      id = fromUrl;
    } else {
      id = window.localStorage.getItem(KEY);
    }
  } catch (e) {
    /* no window / private mode: fall through to the default */
  }
  return VENUES.find((v) => v.id === id) || VENUES[0];
}

/** Switches to another venue and reloads the app on its start page. */
export function selectVenue(id: string) {
  try {
    window.localStorage.setItem(KEY, id);
  } catch (e) {
    /* private mode: the address parameter below still carries the choice */
  }
  window.location.assign(`${process.env.PUBLIC_URL || ''}/?venue=${encodeURIComponent(id)}`);
}
