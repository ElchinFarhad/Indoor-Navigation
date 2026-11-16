import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { building } from '../db/dijkstra';
import { currentVenue } from '../db/venues';
import { plural, t } from '../i18n';
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

/** Lower case without accents, so "creme" finds "Crème". */
function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** "Brand · 1 l", for catalogues that know it. */
export function productDetail(p: { brand?: string; quantity?: string }): string {
  return [p.brand, p.quantity].filter(Boolean).join(' · ');
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
    const has = (text: string | undefined) => !!text && plain(text).includes(plain(q));
    const pool = q
      ? building.products.filter((p) => has(p.name) || has(p.brand) || has(p.section.name))
      : building.featured.length > 0
      ? building.featured
      : building.products.filter((p) => ['milk', 'bread', 'eggs', 'apples', 'coffee', 'spaghetti', 'still-water', 'toilet-paper'].indexOf(p.id) >= 0);
    return pool.slice(0, 12);
  }, [q]);

  // A catalogue with brands and photos gets rows instead of chips.
  const rich = building.products.some((p) => !!p.brand || !!p.image);
  const trip = useMemo(() => planTrip(building, ids, startId), [ids, startId]);
  const toggle = (id: string) => setIds((list) => (list.indexOf(id) >= 0 ? list.filter((x) => x !== id) : list.concat(id)));

  return (
    <section className="shopping" aria-label={t('Shopping list')}>
      <div className="shopping__head">
        <h2>{t('Shopping list')}</h2>
        {ids.length > 0 && (
          <button type="button" className="shopping__clear" onClick={() => setIds([])}>
            {t('Clear')}
          </button>
        )}
      </div>

      {ids.length === 0 ? (
        <p className="shopping__empty">{t('Add what you need. The app works out the shortest way round the shop and takes you from shelf to shelf.')}</p>
      ) : (
        <ul className="shopping__items">
          {ids.map((id) => {
            const p = building.product(id)!;
            return (
              <li key={id}>
                <span>
                  <strong>{p.name}</strong>
                  <small>{[productDetail(p), p.section.name].filter(Boolean).join(' · ')}</small>
                </span>
                <button type="button" aria-label={t('Remove {name}', { name: p.name })} onClick={() => toggle(id)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="shopping__label">{q ? t('Matching products') : t('Often bought')}</p>
      <div className={`shopping__products${rich ? ' shopping__products--rich' : ''}`}>
        {matches.map((p) => {
          const on = ids.indexOf(p.id) >= 0;
          return (
            <button key={p.id} type="button" className={`product${on ? ' is-on' : ''}${rich ? ' product--rich' : ''}`} aria-pressed={on} aria-label={on ? t('Remove {name}', { name: p.name }) : t('Add {name}', { name: p.name })} onClick={() => toggle(p.id)}>
              <span>{on ? '✓' : '+'}</span>
              {rich && p.image && <img src={p.image} alt="" loading="lazy" width={36} height={36} onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />}
              {rich ? (
                <span className="product__text">
                  <strong>{p.name}</strong>
                  <small>{[productDetail(p), p.section.name].filter(Boolean).join(' · ')}</small>
                </span>
              ) : (
                p.name
              )}
            </button>
          );
        })}
        {matches.length === 0 && <span className="shopping__none">{t('No product matches “{query}”.', { query })}</span>}
      </div>

      {/* Always within reach of the thumb, wherever the page is scrolled to. */}
      {trip.stops.length > 0 && (
        <div className="cta-bar">
          <div className="cta-bar__info">
            <strong>{plural(ids.length, '{n} item', '{n} items')}</strong>
            <span>{plural(trip.stops.length - 1, '{n} stop · about {d} m', '{n} stops · about {d} m', { d: Math.round(trip.length / 5) * 5 })}</span>
          </div>
          <button type="button" className="btn-nav btn-nav--primary shopping__go" onClick={() => navigate(`shop?items=${ids.join(',')}${startId !== null ? `&from=${startId}` : ''}`)}>
            {t('Start shopping')}
          </button>
        </div>
      )}
    </section>
  );
};

export default ShoppingList;
