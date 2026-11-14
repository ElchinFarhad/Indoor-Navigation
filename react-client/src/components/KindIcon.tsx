import React from 'react';

const PATHS: { [kind: string]: string[] } = {
  classroom: ['M4 5h16v10H4z', 'M12 15v4', 'M8 19h8'],
  auditorium: ['M3 8l9-4 9 4-9 4-9-4z', 'M7 10v4c0 1.4 2.4 2.8 5 2.8s5-1.4 5-2.8v-4', 'M21 8v5'],
  lab: ['M9 3h6', 'M10 3v6l-5 9a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 18l-5-9V3', 'M7.6 15h8.8'],
  office: ['M4 8h16v11H4z', 'M9 8V5h6v3', 'M4 13h16'],
  library: ['M12 6c-2-1.3-4.5-1.6-7-1v13c2.5-.6 5-.3 7 1 2-1.3 4.5-1.6 7-1V5c-2.5-.6-5-.3-7 1z', 'M12 6v13'],
  study: ['M12 6c-2-1.3-4.5-1.6-7-1v13c2.5-.6 5-.3 7 1 2-1.3 4.5-1.6 7-1V5c-2.5-.6-5-.3-7 1z', 'M12 6v13'],
  cafe: ['M5 9h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z', 'M16 10h1.5a2.5 2.5 0 0 1 0 5H16', 'M8 3v2.5', 'M12 3v2.5'],
  restroom: ['M8 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M16 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M8 9v12', 'M5.5 13.5L8 9l2.5 4.5', 'M16 9v12', 'M13.5 9h5', 'M12 3v18'],
  reception: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5.5', 'M12 7.4v.4'],
  lobby: ['M6 21V4h9v17', 'M4 21h16', 'M12 12.2v.8', 'M15 6l3 1.2V21'],
  stairs: ['M3 20h4v-4h4v-4h4V8h4'],
  elevator: ['M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M9 10l3-3 3 3', 'M9 14l3 3 3-3'],
  junction: ['M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z', 'M12 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
};

interface Props {
  kind: string;
  size?: number;
}

/** Line icon for a kind of place (classroom, lab, café...). */
const KindIcon = ({ kind, size = 24 }: Props) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {(PATHS[kind] || PATHS.junction).map((d, i) => (
      <path key={i} d={d} />
    ))}
  </svg>
);

export default KindIcon;
