import React, { useState } from 'react';
import { plural, t } from '../i18n';
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
    <Panel title={t('Shopping list')} onClose={onClose}>
      <p className="panel__lead">
        {trip.pending.length === 0
          ? t('Everything is in the basket.')
          : plural(trip.pending.length, '{n} item to go · about {d} m', '{n} items to go · about {d} m', { d: Math.max(5, Math.round(trip.length / 5) * 5) })}
      </p>

      <label className="trip-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <input type="search" placeholder={t('Add a product')} aria-label={t('Add a product')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {q && (
        <ul className="trip-results">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                aria-label={t('Add {name} to the trip', { name: p.name })}
                onClick={() => {
                  onAdd(p.id);
                  setQuery('');
                }}
              >
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.section.name}</small>
                </span>
                <b>{t('Add')}</b>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="trip-results__none">{t('Nothing matches “{query}”.', { query })}</li>}
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
                  {i === 0 && <em>{t('Next')}</em>}
                </strong>
                {stop.checkout && <small>{t('The trip ends here')}</small>}
                {stop.products.map((p) => (
                  <div key={p.id} className="trip-item">
                    <span>{p.name}</span>
                    <button type="button" aria-label={t('Skip {name}', { name: p.name })} onClick={() => onSkip(p.id)}>
                      {t('Skip')}
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
          <p className="trip-label">{t('Skipped')}</p>
          <div className="trip-chips">
            {trip.skipped.map((id) => (
              <button key={id} type="button" className="product" aria-label={t('Put {name} back on the list', { name: name(id) })} onClick={() => onAdd(id)}>
                <span>+</span>
                {name(id)}
              </button>
            ))}
          </div>
        </>
      )}
      {trip.picked.length > 0 && (
        <>
          <p className="trip-label">{t('In the basket')}</p>
          <p className="trip-picked">{trip.picked.map(name).join(', ')}</p>
        </>
      )}
      {onDirections && (
        <button type="button" className="btn-nav btn-nav--soft trip-directions" onClick={onDirections}>
          {t('Directions to the next stop')}
        </button>
      )}
    </Panel>
  );
};

export default TripPanel;
