import React from 'react';
import { ManeuverType } from '../nav/instructions';

const PATHS: { [k: string]: string[] } = {
  straight: ['M12 20V5', 'M6 11l6-6 6 6'],
  left: ['M18 20v-7a4 4 0 0 0-4-4H6', 'M10 5L6 9l4 4'],
  right: ['M6 20v-7a4 4 0 0 1 4-4h8', 'M14 5l4 4-4 4'],
  'slight-left': ['M14 20v-6L8 8', 'M8 14V8h6'],
  'slight-right': ['M10 20v-6l6-6', 'M16 14V8h-6'],
  'sharp-left': ['M16 20V8l-9 7', 'M7 9v6h6'],
  'sharp-right': ['M8 20V8l9 7', 'M17 9v6h-6'],
  uturn: ['M7 20V9.5a4.5 4.5 0 0 1 9 0V15', 'M12.5 11.5L16 15l3.5-3.5'],
  'stairs-up': ['M3 20h4v-4h4v-4h4V8h4', 'M5 11l4-4', 'M9 10V7H6'],
  'stairs-down': ['M3 8h4v4h4v4h4v4h4', 'M15 5l4 4', 'M19 6v3h-3'],
  'elevator-up': ['M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M9 13l3-3 3 3'],
  'elevator-down': ['M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M9 11l3 3 3-3'],
  arrive: ['M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z', 'M12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  scan: ['M4 8V5a1 1 0 0 1 1-1h3', 'M16 4h3a1 1 0 0 1 1 1v3', 'M20 16v3a1 1 0 0 1-1 1h-3', 'M8 20H5a1 1 0 0 1-1-1v-3', 'M9 9h2v2H9z', 'M13 13h2v2h-2z', 'M13 9h2', 'M9 13v2'],
};

interface Props {
  type: ManeuverType | 'scan';
  size?: number;
  className?: string;
}

/** Line icon for a maneuver ("turn left", "take the stairs"...). */
const ManeuverIcon = ({ type, size = 28, className }: Props) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {(PATHS[type] || PATHS.straight).map((d, i) => (
      <path key={i} d={d} />
    ))}
  </svg>
);

export default ManeuverIcon;
