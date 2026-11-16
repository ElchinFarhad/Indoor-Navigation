/**
 * Shared knowledge about how a floor plan is drawn: colours per kind of room,
 * wall segments (with the door openings cut out) and a canvas renderer used
 * for the ground texture of the 3D walk-through. The SVG map view and the
 * Three.js scene both build on this, so they always show the same building.
 */
import { Floor, PlanDoor, PlanOutline, PlanRoom } from '../nav/building';

export interface KindStyle {
  /** Fill colour of the room on the map. */
  fill: string;
  /** Plural category name for filters ("Classrooms"). */
  category: string;
}

const STYLES: { [kind: string]: KindStyle } = {
  classroom: { fill: '#e6edfb', category: 'Classrooms' },
  auditorium: { fill: '#e9e5f8', category: 'Classrooms' },
  lab: { fill: '#e2f3ea', category: 'Labs' },
  office: { fill: '#f4eee4', category: 'Offices' },
  reception: { fill: '#fdebd3', category: 'Services' },
  cafe: { fill: '#fde6d8', category: 'Services' },
  library: { fill: '#f8f0d6', category: 'Services' },
  study: { fill: '#f8f0d6', category: 'Services' },
  restroom: { fill: '#def0f7', category: 'Services' },
  stairs: { fill: '#e3e7ef', category: 'Stairs & lifts' },
  elevator: { fill: '#e3e7ef', category: 'Stairs & lifts' },
  lobby: { fill: '#ffffff', category: 'Entrances' },
  // supermarket departments
  produce: { fill: '#dff3d8', category: 'Fresh' },
  bakery: { fill: '#f8e6c8', category: 'Fresh' },
  meat: { fill: '#f9dcd9', category: 'Fresh' },
  fish: { fill: '#d9ecf8', category: 'Fresh' },
  dairy: { fill: '#e8eefb', category: 'Fresh' },
  frozen: { fill: '#dcf1f5', category: 'Frozen' },
  pantry: { fill: '#f6efd9', category: 'Food cupboard' },
  snacks: { fill: '#fbe6d2', category: 'Food cupboard' },
  drinks: { fill: '#e6e3f7', category: 'Drinks' },
  household: { fill: '#e7ebf0', category: 'Household' },
  care: { fill: '#f6e1ee', category: 'Household' },
  checkout: { fill: '#e3e7ef', category: 'Checkout' },
  // a shelf bay with nothing assigned to it
  empty: { fill: '#f1f2f5', category: 'Other' },
};

const DEFAULT_STYLE: KindStyle = { fill: '#eceff4', category: 'Other' };

export const CORRIDOR_FILL = '#ffffff';
export const WALL_COLOR = '#8f99ad';
export const OUTLINE_COLOR = '#4d566b';

/** Colours of surveyed outlines (see PlanOutline), by kind. */
export const OUTLINE_FILL: { [kind: string]: string } = {
  site: '#e3e6ec',
  shop: '#d5d9e2',
  corridor: '#f1f3f6',
  store: CORRIDOR_FILL,
};
/** Colour around the building when the plan has surveyed outlines. */
export const OUTSIDE_FILL = '#c9ccd3';

export function outlineFill(outline: PlanOutline): string {
  return OUTLINE_FILL[outline.kind] || OUTLINE_FILL.shop;
}

/** The middle of an outline's bounding box and its size, for placing its name. */
export function outlineBox(outline: PlanOutline) {
  const xs = outline.points.map((p) => p[0]);
  const ys = outline.points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function kindStyle(kind: string): KindStyle {
  return STYLES[kind] || DEFAULT_STYLE;
}

/** Order in which categories are offered as filters. */
export const CATEGORY_ORDER = ['Classrooms', 'Labs', 'Offices', 'Services', 'Fresh', 'Food cupboard', 'Drinks', 'Frozen', 'Household', 'Checkout', 'Entrances', 'Stairs & lifts', 'Other'];

/** Width of a door opening in map units. */
export function doorWidth(door: PlanDoor, metersPerUnit: number): number {
  return door.width || 1 / metersPerUnit;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The two end points of a door opening, along the wall it sits in. */
export function doorSegment(room: PlanRoom, door: PlanDoor, metersPerUnit: number): Segment {
  const half = doorWidth(door, metersPerUnit) / 2;
  const horizontal = Math.abs(door.y - room.y) < 0.5 || Math.abs(door.y - (room.y + room.h)) < 0.5;
  return horizontal
    ? { x1: door.x - half, y1: door.y, x2: door.x + half, y2: door.y }
    : { x1: door.x, y1: door.y - half, x2: door.x, y2: door.y + half };
}

/** Walls of a floor as line segments, with the door openings left out. */
export function wallSegments(floor: Floor, metersPerUnit: number): Segment[] {
  const out: Segment[] = [];
  for (const room of floor.rooms) {
    const sides: Segment[] = [
      { x1: room.x, y1: room.y, x2: room.x + room.w, y2: room.y },
      { x1: room.x, y1: room.y + room.h, x2: room.x + room.w, y2: room.y + room.h },
      { x1: room.x, y1: room.y, x2: room.x, y2: room.y + room.h },
      { x1: room.x + room.w, y1: room.y, x2: room.x + room.w, y2: room.y + room.h },
    ];
    for (const side of sides) {
      const horizontal = side.y1 === side.y2;
      // Openings along this side, as [from, to] intervals of the running coordinate.
      const gaps: number[][] = [];
      for (const door of room.solid ? [] : room.doors || []) {
        const d = doorSegment(room, door, metersPerUnit);
        if (horizontal && d.y1 === d.y2 && Math.abs(d.y1 - side.y1) < 0.5) gaps.push([d.x1, d.x2]);
        if (!horizontal && d.x1 === d.x2 && Math.abs(d.x1 - side.x1) < 0.5) gaps.push([d.y1, d.y2]);
      }
      gaps.sort((a, b) => a[0] - b[0]);
      let from = horizontal ? side.x1 : side.y1;
      const end = horizontal ? side.x2 : side.y2;
      for (const gap of gaps) {
        if (gap[0] > from + 0.5) {
          out.push(horizontal ? { x1: from, y1: side.y1, x2: gap[0], y2: side.y1 } : { x1: side.x1, y1: from, x2: side.x1, y2: gap[0] });
        }
        from = Math.max(from, gap[1]);
      }
      if (end > from + 0.5) {
        out.push(horizontal ? { x1: from, y1: side.y1, x2: end, y2: side.y1 } : { x1: side.x1, y1: from, x2: side.x1, y2: end });
      }
    }
  }
  // The surveyed outline of the store is a wall too, open where an entrance door meets it.
  const entrances: PlanDoor[] = [];
  for (const room of floor.rooms) for (const door of room.doors || []) if (door.entrance) entrances.push(door);
  for (const outline of floor.outlines) {
    if (outline.kind !== 'store') continue;
    const pts = outline.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i][0];
      const ay = pts[i][1];
      const dx = pts[i + 1][0] - ax;
      const dy = pts[i + 1][1] - ay;
      const length = Math.hypot(dx, dy);
      if (length < 0.5) continue;
      const gaps: number[][] = [];
      for (const door of entrances) {
        const along = ((door.x - ax) * dx + (door.y - ay) * dy) / length;
        const across = Math.abs((door.x - ax) * dy - (door.y - ay) * dx) / length;
        const half = doorWidth(door, metersPerUnit) / 2;
        if (across < 3 && along > -half && along < length + half) gaps.push([along - half, along + half]);
      }
      gaps.sort((a, b) => a[0] - b[0]);
      let from = 0;
      const piece = (a: number, b: number) => out.push({ x1: ax + (dx * a) / length, y1: ay + (dy * a) / length, x2: ax + (dx * b) / length, y2: ay + (dy * b) / length });
      for (const gap of gaps) {
        if (gap[0] > from + 0.5) piece(from, Math.min(gap[0], length));
        from = Math.max(from, gap[1]);
      }
      if (length > from + 0.5) piece(from, length);
    }
  }
  return out;
}

/** Draws a floor plan on a 2D canvas (used as the ground of the 3D view). */
export function drawPlan(ctx: CanvasRenderingContext2D, floor: Floor, scale: number, metersPerUnit: number) {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = floor.outlines.length > 0 ? OUTSIDE_FILL : CORRIDOR_FILL;
  ctx.fillRect(0, 0, floor.width, floor.height);
  for (const outline of floor.outlines) {
    ctx.fillStyle = outlineFill(outline);
    ctx.beginPath();
    outline.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.closePath();
    ctx.fill();
    if (outline.kind === 'shop') {
      ctx.strokeStyle = 'rgba(77, 86, 107, 0.35)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  for (const room of floor.rooms) {
    ctx.fillStyle = kindStyle(room.kind).fill;
    ctx.fillRect(room.x, room.y, room.w, room.h);
  }
  // A faint tile pattern so movement over the floor is visible.
  ctx.strokeStyle = 'rgba(77, 86, 107, 0.07)';
  ctx.lineWidth = 0.4;
  const tile = 1 / metersPerUnit;
  ctx.beginPath();
  for (let x = 0; x <= floor.width; x += tile) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, floor.height);
  }
  for (let y = 0; y <= floor.height; y += tile) {
    ctx.moveTo(0, y);
    ctx.lineTo(floor.width, y);
  }
  ctx.stroke();
  ctx.strokeStyle = WALL_COLOR;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const s of wallSegments(floor, metersPerUnit)) {
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
  }
  ctx.stroke();
  ctx.restore();
}
