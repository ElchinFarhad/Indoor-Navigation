/**
 * Venue data for unit tests: compiled from venues-src/ by the same script that
 * publishes it, so tests always run on what the app would load.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore: a CommonJS build script without type declarations
import venues from '../../scripts/venues.js';
import { assembleVenue } from '../db/assemble';
import { RawGraph } from '../nav/building';

export const compiled: { entry: any; map: any; catalog: any; report: any }[] = venues.compileAll();

/** The assembled graph of one venue, in the current language. */
export function venueGraph(id: string): RawGraph {
  const v = compiled.find((c) => c.entry.id === id);
  if (!v) throw new Error(`No venue "${id}" in venues-src`);
  return assembleVenue(v.map, v.catalog);
}
