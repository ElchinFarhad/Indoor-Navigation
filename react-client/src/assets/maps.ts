/**
 * Floor plan images referenced by `meta.floors[].map` in db/graph.json.
 * Add an entry here when a new floor image is dropped into this folder.
 */
import map from './map.png';

const MAPS: { [file: string]: string } = {
  'map.png': map,
};

export function floorPlanUrl(file: string | undefined): string | undefined {
  return file ? MAPS[file] : undefined;
}
