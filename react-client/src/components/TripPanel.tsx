import React, { useState } from 'react';
import { Building } from '../nav/building';
import { ShoppingTrip } from '../nav/shopping';
import KindIcon from './KindIcon';
import { Panel } from './NavPanels';

interface Props {
  building: Building;
  trip: ShoppingTrip;
  onAdd: (productId: string) => void;
  onSkip: (productId: string) => void;
  /** Opens the turn-by-turn list of the current leg. */
  onDirections?: () => void;
  onClose: () => void;
}

/**
 * The shopping list during a trip: what comes next and where, with a way to
 * skip a product (not on the shelf, changed your mind), to put a skipped one
 * back, and to add something you just thought of. Every change re-plans the
 * rest of the trip from where you are.
 */
const TripPanel = ({ building, trip, onAdd, onSkip, onDirections, onClose }: Props) => {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = q
    ? building.products
        .filter((p) => trip.pending.indexOf(p.id) < 0)
        .filter((p) => p.name.toLowerCase().includes(q) || p.section.name.toLowerCase().includes(q))
        .slice(0, 6)
    : [];
  const name = (id: string) => (building.product(id) || { name: id }).name;

  return (
    <Panel title="Shopping list" onClose={onClose}>
      <p className="panel__lead">
        {trip.pending.length === 0
          ? 'Everything is in the basket.'
          : `${trip.pending.length} item${trip.pending.length === 1 ? '' : 's'} to go · about ${Math.max(5, Math.round(trip.length / 5) * 5)} m`}
      </p>

      <label className="trip-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <input type="search" placeholder="Add a product" aria-label="Add a product" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {q && (
        <ul className="trip-results">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-label={`Add ${p.name} to the trip`}
                onClick={() => {
                  onAdd(p.id);
                  setQuery('');
                }}
              >
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.section.name}</small>
                </span>
                <b>Add</b>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="trip-results__none">Nothing found for “{query}”.</li>}
        </ul>
      )}

      <ol className="trip-stops">
        {trip.stops.map((stop, i) => {
          const node = building.node(stop.nodeId)!;
          return (
            <li key={stop.nodeId} className={i === 0 ? 'is-current' : ''}>
              <span className="trip-stops__icon">
                <KindIcon kind={node.kind} size={22} />
              </span>
              <div>
                <strong>
                  {building.displayName(node)}
                  {i === 0 && <em>Next</em>}
                </strong>
                {stop.checkout && <small>The trip ends here</small>}
                {stop.products.map((p) => (
                  <div key={p.id} className="trip-item">
                    <span>{p.name}</span>
                    <button type="button" aria-label={`Skip ${p.name}`} onClick={() => onSkip(p.id)}>
                      Skip
                    </button>
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>

      {trip.skipped.length > 0 && (
        <>
          <p className="trip-label">Skipped</p>
          <div className="trip-chips">
            {trip.skipped.map((id) => (
              <button key={id} type="button" className="product" aria-label={`Put ${name(id)} back on the list`} onClick={() => onAdd(id)}>
                <span>+</span>
                {name(id)}
              </button>
            ))}
          </div>
        </>
      )}
      {trip.picked.length > 0 && (
        <>
          <p className="trip-label">In the basket</p>
          <p className="trip-picked">{trip.picked.map(name).join(', ')}</p>
        </>
      )}
      {onDirections && (
        <button type="button" className="btn-nav btn-nav--soft trip-directions" onClick={onDirections}>
          Directions to the next stop
        </button>
      )}
    </Panel>
  );
};

export default TripPanel;
