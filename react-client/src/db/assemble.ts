/**
 * Puts a venue together from its two files:
 *
 *   map      the place: floors, shelf bays with their location codes, the
 *            walkable graph, the markers (changes rarely)
 *   catalog  what stands at each location code, and which product is at
 *            which code (changes often)
 *
 * The result is the graph the Building class reads, in the current language.
 * A shelf bay on the map only has a code ("A03-02"); its name, colour and id
 * come from the section the catalog assigns to that code. Moving a section or
 * a product is therefore a change of the catalog alone.
 */
import { localized } from '../i18n';
import { RawGraph } from '../nav/building';

export interface CatalogLocation {
  code: string;
  /** Stable id of the section assigned to this place ("milk"). */
  section: string;
  name: string;
  kind: string;
}

export interface CatalogProduct {
  id: string;
  name: string;
  /** Location code of the shelf bay. */
  location: string;
  brand?: string;
  quantity?: string;
  image?: string;
}

export interface Catalog {
  locations: CatalogLocation[];
  products: CatalogProduct[];
}

export function assembleVenue(map: any, catalog: Catalog | null | undefined): RawGraph {
  const byCode = new Map<string, CatalogLocation>();
  for (const l of (catalog && catalog.locations) || []) byCode.set(l.code, l);
  const sectionOf = new Map<string, string>(); // location code -> room id

  const meta = map.meta || {};
  const floors = (meta.floors || []).map((floor: any) => ({
    ...floor,
    name: localized(floor, 'name'),
    short: localized(floor, 'short'),
    spoken: localized(floor, 'spoken'),
    outlines: floor.outlines,
    rooms: (floor.rooms || []).map((room: any) => {
      if (!room.code) return { ...room, name: localized(room, 'name'), short: localized(room, 'short') };
      const assigned = byCode.get(room.code);
      // (A bay with nothing assigned stays on the map as an unnamed block.)
      const id = assigned ? assigned.section : room.code;
      const name = assigned ? localized(assigned, 'name')! : room.code;
      sectionOf.set(room.code, id);
      return { ...room, id, name, short: (assigned && localized(assigned, 'short')) || name, kind: assigned ? assigned.kind : 'empty' };
    }),
  }));

  const nodes = (map.nodes || []).map((node: any) => {
    const out = { ...node, label: localized(node, 'label') };
    if (node.room && sectionOf.has(node.room)) {
      const assigned = byCode.get(node.room);
      out.room = sectionOf.get(node.room);
      if (assigned) out.label = localized(assigned, 'name');
      // Nothing there: a point in the aisle, not a destination.
      else out.type = 'node';
    }
    return out;
  });

  const products = ((catalog && catalog.products) || [])
    .filter((p) => sectionOf.has(p.location) && byCode.has(p.location))
    .map((p) => ({ id: p.id, name: localized(p, 'name')!, section: sectionOf.get(p.location)!, brand: p.brand, quantity: p.quantity, image: p.image }));

  return {
    meta: { ...meta, name: localized(meta, 'name'), attribution: localized(meta, 'attribution'), floors },
    nodes,
    products,
  };
}
