import { useState } from 'react';
import { building } from '../db/dijkstra';
import { t } from '../i18n';
import NavbarComp from './NavbarComp';

/** Who runs this installation: set at build time (see docs/DEPLOYMENT.md). */
const OPERATOR: string = import.meta.env.VITE_OPERATOR_NAME || '';
const CONTACT: string = import.meta.env.VITE_OPERATOR_CONTACT || '';

/** Everything the app keeps on the phone starts with this. */
const PREFIX = 'indoor-nav.';

function storedKeys(): string[] {
  try {
    return Object.keys(window.localStorage).filter((k) => k.indexOf(PREFIX) === 0);
  } catch {
    return [];
  }
}

/**
 * The privacy notice. It describes what the code actually does: the wording
 * must be kept in step with the code, and whoever operates an installation
 * has to review it with their data protection officer before going live.
 */
const Privacy = () => {
  const [count, setCount] = useState(() => storedKeys().length);
  const thirdPartyImages = building.products.some((p) => !!p.image && /^https?:/.test(p.image));

  const erase = () => {
    try {
      for (const key of storedKeys()) window.localStorage.removeItem(key);
    } catch {
      /* nothing is stored in private mode */
    }
    setCount(0);
  };

  return (
    <div className="page">
      <NavbarComp />
      <main className="content content--prose">
        <h1>{t('Privacy')}</h1>
        <p className="lead">{t('This app finds your way inside a building without learning who you are. It has no account, no advertising and no tracking, and your position never leaves your phone.')}</p>

        <h2>{t('What happens on your phone only')}</h2>
        <ul className="facts">
          <li>
            <strong>{t('Camera.')}</strong>{' '}
            {t('The camera image is searched for QR markers by code running in your browser. No picture or video is recorded, stored or sent anywhere.')}
          </li>
          <li>
            <strong>{t('Motion sensors.')}</strong> {t('Steps and turns are read from the motion sensors to follow you between markers. The readings are used at once and not kept.')}
          </li>
          <li>
            <strong>{t('Your position and route.')}</strong> {t('They are worked out on the phone. Nobody else, including the operator of this service, can see where you are or where you went.')}
          </li>
        </ul>

        <h2>{t('What is stored on your phone')}</h2>
        <p>{t('To be useful the next time, the browser keeps a few settings on this device: your shopping list, the place and language you chose, and your sound settings. They are not cookies, are not sent to a server, and cannot be read by other sites.')}</p>
        <p>
          <button type="button" className="btn-nav btn-nav--soft" onClick={erase} disabled={count === 0}>
            {t('Delete what is stored on this phone')}
          </button>{' '}
          <span className="footnote" role="status">
            {count === 0 ? t('Nothing is stored at the moment.') : t('{n} setting(s) stored.', { n: count })}
          </span>
        </p>

        <h2>{t('What reaches a server')}</h2>
        <ul className="facts">
          <li>
            <strong>{t('Loading the app.')}</strong>{' '}
            {t('Like any web page, the app and the map are downloaded from a web server, which sees the technical data of the request: your IP address, the time and the type of browser. This is needed to deliver the page and is not combined with anything else.')}
          </li>
          <li>
            <strong>{t('Spoken directions.')}</strong>{' '}
            {t("They use the voices of your phone. Some browsers offer online voices: with those, the sentence to be spoken is sent to the browser's maker. Choose a voice stored on the device, or switch the voice off, to avoid this.")}
          </li>
          {thirdPartyImages && (
            <li>
              <strong>{t('Product photos in this demonstration.')}</strong>{' '}
              {t('This demonstration place shows product photos loaded from Open Food Facts, whose server therefore sees your IP address. Places operated for customers load nothing from third parties.')}
            </li>
          )}
        </ul>

        <h2>{t('What the app does not do')}</h2>
        <p>{t('No registration, no analytics, no advertising, no profiling, no location history, no sharing of data with anyone.')}</p>

        <h2>{t('Who is responsible')}</h2>
        <p>
          {OPERATOR ? t('This service is operated by {operator}.', { operator: OPERATOR }) : t('This is a demonstration installation without a commercial operator.')}{' '}
          {CONTACT && t('For any question about your data, or to exercise your rights under the GDPR, write to {contact}.', { contact: CONTACT })}
        </p>
        <p className="footnote">{t('You can also lodge a complaint with your data protection authority; in Italy this is the Garante per la protezione dei dati personali.')}</p>
      </main>
    </div>
  );
};

export default Privacy;
