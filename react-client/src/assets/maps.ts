/**
 * Optional raster floor plans referenced by `meta.floors[].map` in db/graph.json.
 *
 * The shipped building is drawn from vector data (rooms and corridors in the
 * JSON), so nothing is registered here. To put an image of a real floor plan
 * under the map, drop it in this folder and register it:
 *
 *   import ground from './ground-floor.png';
 *   const MAPS = { 'ground-floor.png': ground };
 */
const MAPS: { [file: string]: string } = {};

export function floorPlanUrl(file: string | undefined): string | undefined {
  return file ? MAPS[file] : undefined;
}
