import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { building } from '../db/dijkstra';
import { NavNode } from '../nav/building';
import { walkingDistance } from '../nav/routing';
import NavbarComp from './NavbarComp';

/**
 * Destination picker.
 *
 * Opened plainly it lists every room. Opened through a marker link that
 * carries `?at=<marker id>` it already knows where the user is, shows the
 * walking distance to each room and starts navigation without a first scan.
 */
const HomePage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [floor, setFloor] = useState<number | 'all'>('all');

  const at = useMemo(() => {
    const value = new URLSearchParams(location.search).get('at');
    const node = value !== null ? building.node(parseInt(value, 10)) : undefined;
    return node || null;
  }, [location.search]);

  const rooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    return building
      .rooms()
      .filter((r) => floor === 'all' || r.floor === floor)
      .filter((r) => !q || building.displayName(r).toLowerCase().includes(q) || r.name.toLowerCase() === q)
      .map((room) => ({ room, distance: at ? walkingDistance(building, at.id, room.id) : null }))
      .sort((a, b) =>
        a.distance !== null && b.distance !== null
          ? a.distance - b.distance
          : a.room.floor - b.room.floor || a.room.name.localeCompare(b.room.name)
      );
  }, [query, floor, at]);

  function handleClick(room: NavNode) {
    navigate(`qrScanner/${room.id}${at ? `?from=${at.id}` : ''}`);
  }

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
            <p className="hero__lead">Pick a destination, scan one QR marker, then follow the arrows on your camera.</p>
          )}
          <label className="search">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <input
              type="search"
              placeholder="Search rooms"
              aria-label="Search rooms"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
      </header>

      <main className="content">
        {building.floors.length > 1 && (
          <div className="chips" role="tablist" aria-label="Floor filter">
            <button type="button" role="tab" aria-selected={floor === 'all'} className={`chip${floor === 'all' ? ' is-active' : ''}`} onClick={() => setFloor('all')}>
              All floors
            </button>
            {building.floors.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={floor === f.id} className={`chip${floor === f.id ? ' is-active' : ''}`} onClick={() => setFloor(f.id)}>
                {f.name}
              </button>
            ))}
          </div>
        )}

        <h2 className="section-title">Choose Your Destination</h2>

        <ul className="rooms">
          {rooms.map(({ room, distance }) => {
            const f = building.floor(room.floor);
            return (
              <li key={room.id}>
                <button type="button" className="room" onClick={() => handleClick(room)} aria-label={`Navigate to ${building.displayName(room)}`}>
                  <span className="room__badge">{room.name}</span>
                  <span className="room__text">
                    <strong>{building.displayName(room)}</strong>
                    <span>
                      {f ? f.name : `Floor ${room.floor}`}
                      {distance !== null ? ` · ${Math.round(distance)} m` : ''}
                    </span>
                  </span>
                  <span className="room__go">
                    Go
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </button>
              </li>
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
