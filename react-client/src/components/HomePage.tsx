import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { building } from '../db/dijkstra';
import { CATEGORY_ORDER, kindStyle } from '../map/plan';
import { NavNode } from '../nav/building';
import { walkingDistance } from '../nav/routing';
import KindIcon from './KindIcon';
import MapView from './MapView';
import NavbarComp from './NavbarComp';

/**
 * Destination picker.
 *
 * Rooms can be found three ways: by searching, by category, or by tapping
 * them on the floor plan. Opened through a marker link that carries
 * `?at=<marker id>` the page already knows where the user is: it shows the
 * walking distance to each room and starts navigation without a first scan.
 */
const HomePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [floor, setFloor] = useState<number>(building.floors.length > 0 ? building.floors[0].id : 0);
  const [selected, setSelected] = useState<NavNode | null>(null);

  const at = useMemo(() => {
    const value = new URLSearchParams(location.search).get('at');
    const node = value !== null ? building.node(parseInt(value, 10)) : undefined;
    return node || null;
  }, [location.search]);

  const categories = useMemo(() => {
    const present = new Set(building.rooms().map((r) => kindStyle(r.kind).category));
    return ['All'].concat(CATEGORY_ORDER.filter((c) => present.has(c)));
  }, []);

  const rooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    return building
      .rooms()
      .filter((r) => category === 'All' || kindStyle(r.kind).category === category)
      .filter((r) => !q || building.displayName(r).toLowerCase().includes(q) || r.name.toLowerCase() === q)
      .map((room) => ({ room, distance: at ? walkingDistance(building, at.id, room.id) : null }))
      .sort((a, b) =>
        a.distance !== null && b.distance !== null
          ? a.distance - b.distance
          : a.room.floor - b.room.floor || building.displayName(a.room).localeCompare(building.displayName(b.room), undefined, { numeric: true })
      );
  }, [query, category, at]);

  function handleClick(room: NavNode) {
    navigate(`qrScanner/${room.id}${at ? `?from=${at.id}` : ''}`);
  }

  const selectOnMap = (node: NavNode) => {
    setSelected(node);
    setFloor(node.floor);
  };

  const selectedFloor = selected ? building.floor(selected.floor) : undefined;
  let lastFloor: number | null = null;

  return (
    <div className="page">
      <NavbarComp />

      <header className="hero">
        <div className="hero__inner">
          <p className="hero__eyebrow">{building.name}</p>
          <h1>Where do you want to go?</h1>
          {at ? (
            <p className="hero__lead hero__lead--here">
              <span className="dot" /> You are at <b>{building.displayName(at)}</b>
              {building.floor(at.floor) ? `, ${building.floor(at.floor)!.name}` : ''}
            </p>
          ) : (
            <p className="hero__lead">Pick a place, scan one QR marker, then just follow the arrows and the voice.</p>
          )}
          <label className="search">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <input type="search" placeholder="Search rooms" aria-label="Search rooms" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      </header>

      <main className="content">
        <div className="chips" role="tablist" aria-label="Category">
          {categories.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={category === c} className={`chip${category === c ? ' is-active' : ''}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>

        {building.hasPlan && (
          <section className="browse" aria-label="Floor plan">
            {building.floors.length > 1 && (
              <div className="browse__floors" role="tablist" aria-label="Floor">
                {building.floors.map((f) => (
                  <button key={f.id} type="button" role="tab" aria-selected={floor === f.id} className={floor === f.id ? 'is-active' : ''} onClick={() => setFloor(f.id)}>
                    {f.name}
                  </button>
                ))}
              </div>
            )}
            <div className="browse__map">
              <MapView building={building} floor={floor} destinationId={selected ? selected.id : null} onSelectRoom={selectOnMap} />
            </div>
            {selected ? (
              <div className="browse__selected">
                <span className="room__badge">
                  <KindIcon kind={selected.kind} />
                </span>
                <span className="room__text">
                  <strong>{building.displayName(selected)}</strong>
                  <span>{selectedFloor ? selectedFloor.name : ''}</span>
                </span>
                <button type="button" className="btn-nav btn-nav--primary" onClick={() => handleClick(selected)}>
                  Navigate
                </button>
              </div>
            ) : (
              <p className="browse__hint">Tap a room on the map, or choose one from the list.</p>
            )}
          </section>
        )}

        <h2 className="section-title">Choose Your Destination</h2>

        <ul className="rooms">
          {rooms.map(({ room, distance }) => {
            const f = building.floor(room.floor);
            const heading = at === null && room.floor !== lastFloor ? (f ? f.name : `Floor ${room.floor}`) : null;
            lastFloor = room.floor;
            return (
              <React.Fragment key={room.id}>
                {heading && <li className="rooms__floor">{heading}</li>}
                <li>
                  <button type="button" className="room" onClick={() => handleClick(room)} aria-label={`Navigate to ${building.displayName(room)}`}>
                    <span className="room__badge" style={{ background: kindStyle(room.kind).fill }}>
                      <KindIcon kind={room.kind} />
                    </span>
                    <span className="room__text">
                      <strong>{building.displayName(room)}</strong>
                      <span>
                        {f ? f.name : `Floor ${room.floor}`}
                        {distance !== null ? ` · ${Math.round(distance)} m` : ''}
                      </span>
                    </span>
                    <span className="room__go" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </button>
                </li>
              </React.Fragment>
            );
          })}
        </ul>
        {rooms.length === 0 && <p className="empty">No room matches “{query}”.</p>}

        <p className="footnote">
          Politecnico di Torino · <Link to="/about">How it works</Link>
        </p>
      </main>
    </div>
  );
};

export default HomePage;
