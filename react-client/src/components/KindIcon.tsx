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
  // supermarket departments share a basket; the fresh counters have their own
  produce: ['M12 8c-3-2.5-7-1-7 3.5 0 4 3 8.5 5 8.5 1 0 1.3-.5 2-.5s1 .5 2 .5c2 0 5-4.5 5-8.5 0-4.5-4-6-7-3.5z', 'M12 8c0-2 1-3.5 3-4'],
  bakery: ['M4 13c0-3.5 3.5-6 8-6s8 2.5 8 6c0 1.5-1 2.5-2 2.5v3H6v-3c-1 0-2-1-2-2.5z', 'M9 10.5v3', 'M12 10v3.5', 'M15 10.5v3'],
  meat: ['M15 4c3 0 5 2.5 5 5.5 0 4-4 7-8.5 7-1.5 0-2.5 1-3 2.5l-2 .5-.5-2c1.5-.5 2.5-1.5 2.5-3C8.5 9 11 4 15 4z', 'M15 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'],
  fish: ['M3 12c3-4 7-5.500 11-5 3 .5 5 2.500 7 5-2 2.500-4 4.500-7 5-4 .500-8-1-11-5z', 'M3 8l3 4-3 4', 'M16 11v.01'],
  dairy: ['M9 3h6v3l2 4v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V10l2-4z', 'M7 13h10'],
  frozen: ['M12 3v18', 'M4.200 7.500l15.600 9', 'M19.800 7.500l-15.600 9', 'M9.500 4.500L12 7l2.500-2.500', 'M9.500 19.500L12 17l2.500 2.500'],
  drinks: ['M9 3h6', 'M10 3v4l-2 3v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V10l-2-3V3', 'M8 14h8'],
  pantry: ['M5 8h14l-1.500 11H6.500z', 'M8 8l2-4', 'M16 8l-2-4', 'M3 8h18'],
  snacks: ['M5 8h14l-1.500 11H6.500z', 'M8 8l2-4', 'M16 8l-2-4', 'M3 8h18'],
  household: ['M5 8h14l-1.500 11H6.500z', 'M8 8l2-4', 'M16 8l-2-4', 'M3 8h18'],
  care: ['M5 8h14l-1.500 11H6.500z', 'M8 8l2-4', 'M16 8l-2-4', 'M3 8h18'],
  checkout: ['M4 5h2l2.500 10h9L20 8H7.500', 'M9.500 19.500a1 1 0 1 0 0-.01', 'M16.500 19.500a1 1 0 1 0 0-.01'],
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
