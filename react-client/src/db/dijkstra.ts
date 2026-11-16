/**
 * Shortest path between two QR nodes of the JSON graph database.
 *
 * `shortestPathF` keeps the signature and result shape it always had, so any
 * existing caller keeps working. The search itself now lives in
 * `src/nav/routing.ts` (heap based Dijkstra, multi-floor, can start anywhere
 * along a corridor); this file is the thin compatibility layer on top of it.
 */
import { currentVenue } from './venues';
import { Building, RawGraph } from '../nav/building';
import { shortestPath } from '../nav/routing';

/**
 * The building the app is showing: the venue that was loaded at start-up
 * (see venues.ts). Shared by the whole app.
 */
export const building = new Building(currentVenue().graph as RawGraph);

export interface NextNodeCoordinates {
    /** Map x of the next node on the path (the destination itself when already there). */
    nextNodeX: number;
    /** Map y of the next node on the path. */
    nextNodeY: number;
    /** Node ids from source to destination, both included. Empty if there is no path. */
    shortestPathArray: number[];
}

export function shortestPathF(sourceID: number, destinationID: number): NextNodeCoordinates {
    const source = Number(sourceID);
    const destination = Number(destinationID);
    const path = shortestPath(building, source, destination);
    const shortestPathArray = path ? path.nodeIds : [];

    // The node the user has to walk to next. With no path (unknown ids or
    // disconnected nodes) fall back to the source so callers never dereference
    // an undefined node - the old implementation threw in that case.
    const next = building.node(shortestPathArray.length > 1 ? shortestPathArray[1] : destination)
        || building.node(source);

    return {
        nextNodeX: next ? next.x : 0,
        nextNodeY: next ? next.y : 0,
        shortestPathArray,
    };
}
