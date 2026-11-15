import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { building } from '../db/dijkstra';
import { currentVenue } from '../db/venues';
import { planTrip } from '../nav/shopping';

const KEY = `indoor-nav.list.${currentVenue().id}`;

function load(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((id) => !!building.product(id)) : [];
  } catch (e) {
    return [];
  }
}

interface Props {
  /** Text of the page's search box: matching products are offered for the list. */
  query: string;
  /** Marker the shopper is known to be at, if any. */
  startId: number | null;
  /** True right after a finished trip: the list is cleared. */
  finished: boolean;
}

/**
 * The shopping list of a store: add products, see how long the trip is, start it.
 * The list is kept on the device between visits.
 */
const ShoppingList = ({ query, startId, finished }: Props) => {
  const navigate = useNavigate();
  const [ids, setIds] = useState<string[]>(() => (finished ? [] : load()));

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(ids));
    } catch (e) {
      /* private mode: the list lives for this visit only */
    }
  }, [ids]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const pool = q
      ? building.products.filter((p) => p.name.toLowerCase().includes(q) || p.section.name.toLowerCase().includes(q))
      : building.products.filter((p) => ['milk', 'bread', 'eggs', 'apples', 'coffee', 'spaghetti', 'still-water', 'toilet-paper'].indexOf(p.id) >= 0);
    return pool.slice(0, 12);
  }, [q]);

  const trip = useMemo(() => planTrip(building, ids, startId), [ids, startId]);
  const toggle = (id: string) => setIds((list) => (list.indexOf(id) >= 0 ? list.filter((x) => x !== id) : list.concat(id)));

  return (
    <section className="shopping" aria-label="Shopping list">
      <div className="shopping__head">
        <h2>Shopping list</h2>
        {ids.length > 0 && (
          <button type="button" className="shopping__clear" onClick={() => setIds([])}>
            Clear
          </button>
        )}
      </div>

      {ids.length === 0 ? (
        <p className="shopping__empty">Add what you need. The app works out the shortest way round the shop and takes you from shelf to shelf.</p>
      ) : (
        <ul className="shopping__items">
          {ids.map((id) => {
            const p = building.product(id)!;
            return (
              <li key={id}>
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.section.name}</small>
                </span>
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => toggle(id)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="shopping__label">{q ? 'Matching products' : 'Often bought'}</p>
      <div className="shopping__products">
        {matches.map((p) => {
          const on = ids.indexOf(p.id) >= 0;
          return (
            <button key={p.id} type="button" className={`product${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={`${on ? 'Remove' : 'Add'} ${p.name}`} onClick={() => toggle(p.id)}>
              <span>{on ? '✓' : '+'}</span>
              {p.name}
            </button>
          );
        })}
        {matches.length === 0 && <span className="shopping__none">No product matches “{query}”.</span>}
      </div>

      {/* Always within reach of the thumb, wherever the page is scrolled to. */}
      {trip.stops.length > 0 && (
        <div className="cta-bar">
          <div className="cta-bar__info">
            <strong>
              {ids.length} item{ids.length === 1 ? '' : 's'}
            </strong>
            <span>
              {trip.stops.length - 1} stop{trip.stops.length === 2 ? '' : 's'} · about {Math.round(trip.length / 5) * 5} m
            </span>
          </div>
          <button type="button" className="btn-nav btn-nav--primary shopping__go" onClick={() => navigate(`shop?items=${ids.join(',')}${startId !== null ? `&from=${startId}` : ''}`)}>
            Start shopping
          </button>
        </div>
      )}
    </section>
  );
};

export default ShoppingList;
