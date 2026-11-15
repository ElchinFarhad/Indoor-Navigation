import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { floorPlanUrl } from '../assets/maps';
import { CORRIDOR_FILL, doorSegment, kindStyle } from '../map/plan';
import { Building, NavNode, PlanRoom } from '../nav/building';
import { clamp } from '../nav/geometry';
import { NavSnapshot } from '../nav/navigator';

interface Props {
  building: Building;
  /** Floor to draw. */
  floor: number;
  onFloorChange?: (floor: number) => void;
  /** Live navigation state: position, heading, route. */
  snapshot?: NavSnapshot | null;
  /** Destination to highlight when there is no navigation state yet. */
  destinationId?: number | null;
  /** Small picture-in-picture variant that follows the user and takes no input. */
  compact?: boolean;
  /** When set, markers become tappable (used to choose a start position by hand). */
  onPickNode?: (node: NavNode) => void;
  /** When set, rooms become tappable (used to choose a destination on the map). */
  onSelectRoom?: (node: NavNode) => void;
}

interface View {
  /** Map coordinates at the centre of the view. */
  cx: number;
  cy: number;
  /** Map units per screen pixel. */
  upp: number;
}

const FOLLOW_SPAN = 300; // map units across the view while following the user (30 m)
const COMPACT_SPAN = 170;
const MARGIN = 14; // map units of air around the building when fitted

/** Splits "Seminar room 0.21" into at most two lines that fit `maxChars` each, or null if it cannot fit. */
function wrapLabel(text: string, maxChars: number): string[] | null {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (a.length <= maxChars && b.length <= maxChars) return [a, b];
  }
  return null;
}

/**
 * The floor plan with the route, the destination and the estimated position.
 *
 * The plan is vector data from the JSON database, so it stays sharp at any
 * zoom, every room is an element that can be tapped or highlighted, and the
 * same data also builds the 3D walk-through. Drag to pan, pinch or use the
 * wheel to zoom; the locate button goes back to following the user.
 */
const MapView = ({ building, floor, onFloorChange, snapshot, destinationId, compact, onPickNode, onSelectRoom }: Props) => {
  const f = building.floor(floor) || building.floors[0];
  const mpu = building.metersPerUnit;
  const position = snapshot ? snapshot.position : null;
  const heading = snapshot ? snapshot.heading : null;
  const route = snapshot ? snapshot.route : null;
  const destination = snapshot ? snapshot.destination : destinationId !== null && destinationId !== undefined ? building.node(destinationId) : undefined;
  const here = position && position.floor === f.id ? position : null;

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 420 });
  const [manual, setManual] = useState<View | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(0);

  useLayoutEffect(() => {
    const measure = () => {
      const el = box.current;
      if (el && el.clientWidth && el.clientHeight) setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // A manual view belongs to the floor it was made on.
  useEffect(() => setManual(null), [f.id]);

  const picking = !!onPickNode;

  // The automatic view: follow the user if they are on this floor, otherwise show the whole floor.
  const auto: View = useMemo(() => {
    // (While a marker is being picked the whole floor has to be in reach.)
    if (here && !picking) {
      const span = compact ? COMPACT_SPAN : FOLLOW_SPAN;
      return { cx: here.x, cy: here.y, upp: span / Math.min(size.w, size.h) };
    }
    const upp = Math.max((f.width + 2 * MARGIN) / size.w, (f.height + 2 * MARGIN) / size.h);
    return { cx: f.width / 2, cy: f.height / 2, upp };
  }, [here, picking, compact, size.w, size.h, f.width, f.height]);

  const view = (!compact && manual) || auto;
  const upp = view.upp;
  const vw = size.w * upp;
  const vh = size.h * upp;
  const viewBox = `${view.cx - vw / 2} ${view.cy - vh / 2} ${vw} ${vh}`;
  const px = (n: number) => n * upp; // screen pixels -> map units

  /* ------------------------------------------------------------ gestures */

  const minUpp = 0.25;
  const maxUpp = Math.max((f.width + 2 * MARGIN) / size.w, (f.height + 2 * MARGIN) / size.h) * 1.15;
  const limit = (v: View): View => ({
    upp: clamp(v.upp, minUpp, maxUpp),
    cx: clamp(v.cx, 0, f.width),
    cy: clamp(v.cy, 0, f.height),
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (compact) return;
    if (pointers.current.size === 0) dragged.current = 0;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const before = pointers.current.get(e.pointerId);
    if (compact || !before) return;
    const points = pointers.current;
    const now = { x: e.clientX, y: e.clientY };
    const dx = now.x - before.x;
    const dy = now.y - before.y;
    dragged.current += Math.abs(dx) + Math.abs(dy);
    if (dragged.current < 6) return; // still a tap
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch (err) {
      /* the pointer is already gone */
    }
    if (points.size === 1) {
      setManual(limit({ cx: view.cx - dx * upp, cy: view.cy - dy * upp, upp }));
    } else if (points.size === 2) {
      let other = now;
      points.forEach((p, id) => {
        if (id !== e.pointerId) other = p;
      });
      const d0 = Math.hypot(before.x - other.x, before.y - other.y);
      const d1 = Math.hypot(now.x - other.x, now.y - other.y);
      if (d0 > 0 && d1 > 0) setManual(limit({ cx: view.cx - (dx * upp) / 2, cy: view.cy - (dy * upp) / 2, upp: (upp * d0) / d1 }));
    }
    points.set(e.pointerId, now);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (compact) return;
    setManual(limit({ cx: view.cx, cy: view.cy, upp: upp * (e.deltaY > 0 ? 1.15 : 1 / 1.15) }));
  };

  const zoom = (factor: number) => setManual(limit({ cx: view.cx, cy: view.cy, upp: upp * factor }));
  const tapped = () => dragged.current < 6;

  /* -------------------------------------------------------------- content */

  // Route segments on this floor.
  const segments: string[] = [];
  if (route) {
    let current = '';
    for (const leg of route.legs) {
      if (leg.kind === 'walk' && leg.from.floor === f.id) {
        current += current ? ` L${leg.to.x} ${leg.to.y}` : `M${leg.from.x} ${leg.from.y} L${leg.to.x} ${leg.to.y}`;
      } else if (current) {
        segments.push(current);
        current = '';
      }
    }
    if (current) segments.push(current);
  }

  const destRoom: PlanRoom | undefined = destination ? building.roomOf(destination) : undefined;
  const destHere = !!destination && destination.floor === f.id;
  const plan = floorPlanUrl(f.map);
  const hasVector = f.rooms.length > 0;
  const accuracyUnits = here && snapshot ? clamp(snapshot.accuracy / mpu, px(10), 90) : 0;
  const showMarkers = !!onPickNode || (!compact && upp < 0.9);
  const flow = px(16);
  const mark = onPickNode ? 11 : 7; // marker size in pixels

  // Without a vector plan (an old graph file) fall back to drawing the corridor network.
  const corridors: string[] = [];
  if (!hasVector) {
    for (const n of building.nodes) {
      if (n.floor !== f.id) continue;
      for (const e of building.edgesFrom(n.id)) {
        const other = building.node(e.to)!;
        if (e.kind === 'walk' && e.from < e.to) corridors.push(`M${n.x} ${n.y} L${other.x} ${other.y}`);
      }
    }
  }

  return (
    <div className={`map-view${compact ? ' map-view--compact' : ''}`} ref={box}>
      <svg
        className="map-view__svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={`Map of ${f.name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {/* ------------------------------------------------------ building */}
        <rect x={0} y={0} width={f.width} height={f.height} fill={CORRIDOR_FILL} />
        {plan && <image href={plan} x={0} y={0} width={f.width} height={f.height} preserveAspectRatio="xMinYMin meet" />}
        {corridors.map((d, i) => (
          <path key={i} d={d} className="map-view__corridor" strokeWidth={px(2)} strokeDasharray={`${px(4)} ${px(5)}`} />
        ))}

        {f.rooms.map((room) => {
          const node = room.node !== undefined ? building.node(room.node) : undefined;
          const selectable = !!onSelectRoom && !!node && node.type === 'room';
          const isDest = !!destRoom && destRoom.id === room.id && destHere;
          return (
            <rect
              key={room.id}
              x={room.x}
              y={room.y}
              width={room.w}
              height={room.h}
              fill={kindStyle(room.kind).fill}
              className={`map-view__room${isDest ? ' is-destination' : ''}${selectable ? ' is-selectable' : ''}`}
              strokeWidth={Math.max(1.4, px(1))}
              data-room={room.id}
              onClick={selectable ? () => tapped() && onSelectRoom!(node!) : undefined}
            />
          );
        })}

        {/* door openings: a stroke in the floor colour over the wall */}
        {f.rooms.map((room) =>
          (room.solid ? [] : room.doors || []).map((door, i) => {
            const d = doorSegment(room, door, mpu);
            return (
              <line
                key={`${room.id}-${i}`}
                x1={d.x1}
                y1={d.y1}
                x2={d.x2}
                y2={d.y2}
                className={`map-view__door${door.entrance ? ' map-view__door--entrance' : ''}`}
                strokeWidth={Math.max(2.4, px(2.2))}
              />
            );
          })
        )}
        {hasVector && <rect x={0} y={0} width={f.width} height={f.height} className="map-view__outline" strokeWidth={Math.max(2.6, px(2))} />}

        {/* stairs get a few treads so they read as stairs */}
        {f.rooms
          .filter((r) => r.kind === 'stairs')
          .map((r) => (
            <g key={`treads-${r.id}`} className="map-view__treads" strokeWidth={Math.max(0.8, px(0.8))}>
              {[0.2, 0.32, 0.44, 0.56, 0.68, 0.8].map((t) => (
                <line key={t} x1={r.x + r.w * t} y1={r.y + r.h * 0.16} x2={r.x + r.w * t} y2={r.y + r.h * 0.6} />
              ))}
            </g>
          ))}

        {/* room names, as much as fits at this zoom */}
        {f.rooms.map((room) => {
          const widthPx = room.w / upp;
          const heightPx = room.h / upp;
          const size = compact ? 9 : 11;
          const fits = Math.floor(widthPx / (size * 0.56)) - 1;
          const stairs = room.kind === 'stairs';
          // (the name of a staircase goes under its treads, if there is room for it)
          let lines = !stairs && heightPx > size * 3.2 ? wrapLabel(room.name, fits) : null;
          if (!lines && room.short && room.short.length <= fits && heightPx > size * (stairs ? 5 : 1.6)) lines = [room.short];
          if (!lines) return null;
          const isDest = !!destRoom && destRoom.id === room.id && destHere;
          const cy = room.y + room.h * (stairs ? 0.82 : 0.5);
          return (
            <text
              key={`label-${room.id}`}
              className={`map-view__label${isDest ? ' is-destination' : ''}`}
              x={room.x + room.w / 2}
              y={cy - (px(size) * 1.15 * (lines.length - 1)) / 2}
              fontSize={px(size)}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {lines.map((line, i) => (
                <tspan key={i} x={room.x + room.w / 2} dy={i === 0 ? 0 : px(size) * 1.15}>
                  {line}
                </tspan>
              ))}
            </text>
          );
        })}

        {/* ---------------------------------------------------------- route */}
        {segments.map((d, i) => (
          <g key={i} className="map-view__route-group">
            <path d={d} className="map-view__route-edge" strokeWidth={px(11)} />
            <path d={d} className="map-view__route" strokeWidth={px(7)} />
            <path
              d={d}
              className="map-view__route-flow"
              strokeWidth={px(2.4)}
              strokeDasharray={`${px(1)} ${px(15)}`}
              style={{ ['--flow' as any]: `${-flow}px` }}
            />
          </g>
        ))}

        {/* markers (QR codes on the floor) */}
        {showMarkers &&
          building.nodes
            .filter((n) => n.floor === f.id && n.qr !== null)
            .map((n) => (
              <g
                key={n.id}
                className={`map-view__marker${onPickNode ? ' is-pickable' : ''}`}
                transform={`translate(${n.x} ${n.y})`}
                onClick={onPickNode ? () => tapped() && onPickNode(n) : undefined}
                data-node={n.id}
              >
                {onPickNode && <circle r={px(13)} className="map-view__hit" />}
                <rect x={-px(mark / 2)} y={-px(mark / 2)} width={px(mark)} height={px(mark)} rx={px(mark * 0.25)} strokeWidth={px(1.3)} />
              </g>
            ))}

        {/* destination */}
        {destination && destHere && (
          <g className="map-view__dest" transform={`translate(${destination.x} ${destination.y}) scale(${px(1)})`}>
            <circle r={7} className="map-view__dest-halo" />
            <path d="M0 0 C-11 -13 -10 -27 0 -27 C10 -27 11 -13 0 0 Z" />
            <circle cy={-17.5} r={3.8} className="map-view__dest-dot" />
          </g>
        )}

        {/* the user */}
        {here && (
          <g className="map-view__me" transform={`translate(${here.x} ${here.y})`}>
            <circle r={accuracyUnits} className="map-view__accuracy" strokeWidth={px(1)} />
            <g transform={`scale(${px(1)})`}>
              {heading !== null && (
                <path className="map-view__cone" transform={`rotate(${(heading * 180) / Math.PI})`} d="M0 0 L26 -15 A30 30 0 0 1 26 15 Z" />
              )}
              <circle r={9} className="map-view__me-rim" />
              <circle r={6.2} className="map-view__me-dot" />
            </g>
          </g>
        )}
      </svg>

      {!compact && !!onFloorChange && building.floors.length > 1 && (
        <div className="map-view__floors" role="tablist" aria-label="Floor">
          {building.floors.map((fl) => (
            <button
              key={fl.id}
              type="button"
              role="tab"
              aria-selected={fl.id === f.id}
              className={`map-view__floor${fl.id === f.id ? ' is-active' : ''}${position && position.floor === fl.id ? ' has-me' : ''}`}
              onClick={() => onFloorChange(fl.id)}
            >
              {fl.name}
            </button>
          ))}
        </div>
      )}
      {!compact && (
        <div className="map-view__tools">
          {manual && (
            <button type="button" className="map-view__locate" aria-label={here ? 'Follow my position' : 'Show the whole floor'} onClick={() => setManual(null)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
              </svg>
            </button>
          )}
          <div className="map-view__zoom">
            <button type="button" aria-label="Zoom in" onClick={() => zoom(1 / 1.4)}>
              +
            </button>
            <button type="button" aria-label="Zoom out" onClick={() => zoom(1.4)}>
              −
            </button>
          </div>
        </div>
      )}
      {compact && <span className="map-view__badge">{f.short}</span>}
    </div>
  );
};

export default MapView;
