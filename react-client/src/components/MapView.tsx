import React from 'react';
import { floorPlanUrl } from '../assets/maps';
import { Building, NavNode } from '../nav/building';
import { clamp } from '../nav/geometry';
import { NavSnapshot } from '../nav/navigator';

interface Props {
  building: Building;
  snapshot: NavSnapshot;
  /** Floor to draw. */
  floor: number;
  onFloorChange?: (floor: number) => void;
  /** Small picture-in-picture variant that follows the user. */
  compact?: boolean;
  /** When set, markers become tappable (used to choose a start position by hand). */
  onPickNode?: (node: NavNode) => void;
}

const WINDOW = 130; // map units shown by the compact map

/**
 * Floor plan with the route, the markers and the estimated position.
 *
 * It replaces the fixed 300x300 canvas of the first version with an SVG: the
 * map scales to any screen, stays sharp, and every element is a node that can
 * be styled or tapped.
 */
const MapView = ({ building, snapshot, floor, onFloorChange, compact, onPickNode }: Props) => {
  const f = building.floor(floor) || building.floors[0];
  const mpu = building.metersPerUnit;
  const { position, heading, route, destination } = snapshot;
  const here = position && position.floor === f.id ? position : null;

  let viewBox = `0 0 ${f.width} ${f.height}`;
  if (compact && here) {
    const w = Math.min(WINDOW, f.width);
    const h = Math.min(WINDOW, f.height);
    const x = clamp(here.x - w / 2, 0, f.width - w);
    const y = clamp(here.y - h / 2, 0, f.height - h);
    viewBox = `${x} ${y} ${w} ${h}`;
  }

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

  // Corridor network, drawn faintly so users see where they can walk.
  const corridors: string[] = [];
  for (const n of building.nodes) {
    if (n.floor !== f.id) continue;
    for (const e of building.edgesFrom(n.id)) {
      const other = building.node(e.to)!;
      if (e.kind === 'walk' && e.from < e.to) corridors.push(`M${n.x} ${n.y} L${other.x} ${other.y}`);
    }
  }

  const plan = floorPlanUrl(f.map);
  const accuracyUnits = here ? clamp(snapshot.accuracy / mpu, 5, 80) : 0;
  const onRoute = new Set(route ? route.nodeIds : []);

  return (
    <div className={`map-view${compact ? ' map-view--compact' : ''}`}>
      <svg className="map-view__svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Map of ${f.name}`}>
        <rect x={0} y={0} width={f.width} height={f.height} className="map-view__paper" />
        {plan && <image href={plan} x={0} y={0} width={f.width} height={f.height} preserveAspectRatio="xMinYMin meet" />}
        {corridors.map((d, i) => (
          <path key={i} d={d} className="map-view__corridor" />
        ))}
        {segments.map((d, i) => (
          <g key={i}>
            <path d={d} className="map-view__route-edge" />
            <path d={d} className="map-view__route" />
          </g>
        ))}

        {building.nodes
          .filter((n) => n.floor === f.id)
          .map((n) => {
            const isDest = n.id === destination.id;
            const pickable = !!onPickNode && n.qr !== null;
            const cls =
              'map-view__node' +
              (n.type === 'room' ? ' map-view__node--room' : '') +
              (n.type === 'stairs' || n.type === 'elevator' ? ' map-view__node--stairs' : '') +
              (onRoute.has(n.id) ? ' map-view__node--on-route' : '') +
              (pickable ? ' map-view__node--pickable' : '');
            return (
              <g
                key={n.id}
                className={cls}
                transform={`translate(${n.x} ${n.y})`}
                onClick={pickable ? () => onPickNode!(n) : undefined}
                data-node={n.id}
              >
                {pickable && <circle r={11} className="map-view__hit" />}
                {!isDest && <rect x={-4.5} y={-4.5} width={9} height={9} rx={2.2} />}
                {!isDest && !compact && (
                  <text y={2.4} textAnchor="middle">
                    {n.name}
                  </text>
                )}
              </g>
            );
          })}

        {destination.floor === f.id && (
          <g className="map-view__dest" transform={`translate(${destination.x} ${destination.y})`}>
            <circle r={9} className="map-view__dest-halo" />
            <path d="M0 0 C-7 -8 -6.5 -17 0 -17 C6.5 -17 7 -8 0 0 Z" />
            <circle cy={-11} r={2.4} className="map-view__dest-dot" />
          </g>
        )}

        {here && (
          <g className="map-view__me" transform={`translate(${here.x} ${here.y})`}>
            <circle r={accuracyUnits} className="map-view__accuracy" />
            {heading !== null && (
              <path
                className="map-view__cone"
                transform={`rotate(${(heading * 180) / Math.PI})`}
                d="M0 0 L16 -9 A18.4 18.4 0 0 1 16 9 Z"
              />
            )}
            <circle r={5.2} className="map-view__me-rim" />
            <circle r={3.6} className="map-view__me-dot" />
          </g>
        )}
      </svg>

      {!compact && building.floors.length > 1 && (
        <div className="map-view__floors" role="tablist" aria-label="Floor">
          {building.floors
            .slice()
            .reverse()
            .map((fl) => (
              <button
                key={fl.id}
                type="button"
                role="tab"
                aria-selected={fl.id === f.id}
                className={`map-view__floor${fl.id === f.id ? ' is-active' : ''}${position && position.floor === fl.id ? ' has-me' : ''}`}
                onClick={() => onFloorChange && onFloorChange(fl.id)}
                title={fl.name}
              >
                {fl.short}
              </button>
            ))}
        </div>
      )}
      {compact && <span className="map-view__badge">{f.short}</span>}
    </div>
  );
};

export default MapView;
