/**
 * Typed, validated view of the JSON "database" (src/db/graph.json).
 *
 * The JSON keeps the shape the project always had - a list of nodes, each with
 * an id, a type, map coordinates and a `path` array of weighted neighbours.
 * Everything added on top is optional, so an old graph file still loads:
 *
 *   meta.metersPerUnit   how many metres one map unit is (needed for dead reckoning)
 *   meta.floors          the floors of the building and their map images
 *   node.floor           floor a node is on (default 0)
 *   node.label           human readable name ("Library")
 *   node.qr              how the node's QR marker is mounted, or `false` for no marker
 *   path[].kind          "walk" | "stairs" | "elevator"
 *   path[].length        length in metres, for edges whose map distance means nothing (stairs)
 */
import { direction, distance, DEG, Vec2 } from './geometry';

export type NodeType = 'room' | 'node' | 'stairs' | 'elevator';
export type EdgeKind = 'walk' | 'stairs' | 'elevator';

export interface RawPath {
  nodeID: number;
  weight?: number;
  kind?: string;
  length?: number;
}

export interface RawQr {
  mount?: string;
  /** Floor markers: clockwise rotation of the code's top edge away from "map up", degrees. */
  rotation?: number;
  /** Wall markers: map direction the code faces (the wall's outward normal), degrees. */
  facing?: number;
  /** Printed side length in metres. */
  size?: number;
}

export interface RawNode {
  name: string;
  type: string;
  id: number;
  x: number;
  y: number;
  floor?: number;
  label?: string;
  qr?: boolean | RawQr;
  path: RawPath[];
}

export interface RawFloor {
  id: number;
  name: string;
  short?: string;
  map?: string;
  width?: number;
  height?: number;
}

export interface RawGraph {
  meta?: {
    name?: string;
    metersPerUnit?: number;
    qrSize?: number;
    floors?: RawFloor[];
  };
  nodes: RawNode[];
}

export interface QrMount {
  mount: 'floor' | 'wall';
  /** radians */
  rotation: number;
  /** radians */
  facing: number;
  /** metres */
  size: number;
}

export interface NavNode extends Vec2 {
  id: number;
  name: string;
  label?: string;
  type: NodeType;
  floor: number;
  /** `null` when no QR marker is installed at this node. */
  qr: QrMount | null;
}

/** One direction of a connection between two nodes. */
export interface HalfEdge {
  from: number;
  to: number;
  /** Routing cost (the `weight` of the JSON). */
  cost: number;
  /** Walking length in metres. */
  length: number;
  kind: EdgeKind;
  /** Map direction from -> to, radians. Meaningless for floor changes. */
  dir: number;
}

export interface Floor {
  id: number;
  name: string;
  short: string;
  map?: string;
  width: number;
  height: number;
}

const DEFAULT_FLOOR_CHANGE_LENGTH = 8;

export class Building {
  readonly name: string;
  readonly metersPerUnit: number;
  readonly floors: Floor[];
  readonly nodes: NavNode[] = [];
  /** Problems found while loading (dangling links, asymmetric weights...). */
  readonly warnings: string[] = [];

  private byId = new Map<number, NavNode>();
  private adjacency = new Map<number, HalfEdge[]>();

  constructor(raw: RawGraph) {
    const meta = raw.meta || {};
    this.name = meta.name || 'Building';
    this.metersPerUnit = meta.metersPerUnit && meta.metersPerUnit > 0 ? meta.metersPerUnit : 0.1;
    const defaultQrSize = meta.qrSize && meta.qrSize > 0 ? meta.qrSize : 0.18;

    for (const n of raw.nodes) {
      if (this.byId.has(n.id)) {
        this.warnings.push(`duplicate node id ${n.id}`);
        continue;
      }
      const type: NodeType =
        n.type === 'room' || n.type === 'stairs' || n.type === 'elevator' ? n.type : 'node';
      let qr: QrMount | null = null;
      if (n.qr !== false) {
        const q: RawQr = typeof n.qr === 'object' && n.qr ? n.qr : {};
        qr = {
          mount: q.mount === 'wall' ? 'wall' : 'floor',
          rotation: (q.rotation || 0) * DEG,
          facing: (q.facing || 0) * DEG,
          size: q.size && q.size > 0 ? q.size : defaultQrSize,
        };
      }
      const node: NavNode = {
        id: n.id,
        name: n.name,
        label: n.label,
        type,
        x: n.x,
        y: n.y,
        floor: n.floor || 0,
        qr,
      };
      this.nodes.push(node);
      this.byId.set(node.id, node);
      this.adjacency.set(node.id, []);
    }

    // Edges. The JSON lists each connection from both ends; make sure both
    // directions exist and agree, so routing never depends on which end the
    // user happens to start from.
    for (const n of raw.nodes) {
      for (const p of n.path || []) {
        this.addHalfEdge(n.id, p);
      }
    }
    for (const [from, list] of Array.from(this.adjacency.entries())) {
      for (const e of list.slice()) {
        const back = this.edge(e.to, from);
        if (!back) {
          this.warnings.push(`link ${from} -> ${e.to} has no return link; added one`);
          this.adjacency.get(e.to)!.push({ ...e, from: e.to, to: from, dir: direction(this.node(e.to)!, this.node(from)!) });
        } else if (back.cost !== e.cost) {
          const cost = Math.min(back.cost, e.cost);
          back.cost = cost;
          e.cost = cost;
        }
      }
    }

    const floorIds = Array.from(new Set(this.nodes.map((n) => n.floor))).sort((a, b) => a - b);
    const declared = meta.floors || [];
    this.floors = floorIds.map((id) => {
      const f = declared.find((d) => d.id === id);
      return {
        id,
        name: (f && f.name) || `Floor ${id}`,
        short: (f && f.short) || String(id),
        map: f && f.map,
        width: (f && f.width) || 300,
        height: (f && f.height) || 300,
      };
    });
  }

  private addHalfEdge(from: number, p: RawPath) {
    const a = this.byId.get(from);
    const b = this.byId.get(p.nodeID);
    if (!a || !b) {
      this.warnings.push(`node ${from} links to unknown node ${p.nodeID}`);
      return;
    }
    if (a.id === b.id || this.edge(a.id, b.id)) return;
    const floorChange = a.floor !== b.floor;
    let kind: EdgeKind = 'walk';
    if (p.kind === 'stairs' || p.kind === 'elevator') kind = p.kind;
    else if (floorChange) kind = a.type === 'elevator' || b.type === 'elevator' ? 'elevator' : 'stairs';
    const length =
      p.length && p.length > 0
        ? p.length
        : floorChange
        ? DEFAULT_FLOOR_CHANGE_LENGTH
        : distance(a, b) * this.metersPerUnit;
    const cost = p.weight && p.weight > 0 ? p.weight : length;
    this.adjacency.get(a.id)!.push({ from: a.id, to: b.id, cost, length, kind, dir: direction(a, b) });
  }

  node(id: number): NavNode | undefined {
    return this.byId.get(id);
  }

  edgesFrom(id: number): HalfEdge[] {
    return this.adjacency.get(id) || [];
  }

  edge(from: number, to: number): HalfEdge | undefined {
    return this.edgesFrom(from).find((e) => e.to === to);
  }

  floor(id: number): Floor | undefined {
    return this.floors.find((f) => f.id === id);
  }

  /** Nodes a user can pick as a destination. */
  rooms(): NavNode[] {
    return this.nodes.filter((n) => n.type === 'room');
  }

  /** Nodes that carry a QR marker. */
  markers(): NavNode[] {
    return this.nodes.filter((n) => n.qr !== null);
  }

  /** Display name of a node: its label if it has one, otherwise "Room A" / "Marker B". */
  displayName(node: NavNode): string {
    if (node.label) return node.label;
    if (node.type === 'room') return `Room ${node.name}`;
    if (node.type === 'stairs') return `Stairs ${node.name}`;
    if (node.type === 'elevator') return `Elevator ${node.name}`;
    return `Marker ${node.name}`;
  }
}

/**
 * Extracts the node id a QR marker stands for.
 *
 * The printed markers encode a URL ending in `qrScanner/<id>`; that format is
 * kept. A bare `?at=<id>` / `#at=<id>` parameter is accepted as well.
 */
export function parseMarkerId(content: string): number | null {
  if (!content) return null;
  const m = /qrScanner\/(\d+)(?:\D|$)/.exec(content) || /[?&#]at=(\d+)(?:\D|$)/.exec(content);
  return m ? parseInt(m[1], 10) : null;
}
