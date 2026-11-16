import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { loadVenue } from './db/venues';
import { currentLang, t } from './i18n';

document.documentElement.lang = currentLang();

const root = createRoot(document.getElementById('root')!);

// The venue (map and catalogue) is data on the server, not part of the app:
// load it first, then start the app, whose modules read it as a constant.
loadVenue()
  .then(() => import('./App'))
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  })
  .catch((error) => {
    console.error(error);
    root.render(
      <div className="boot-error" role="alert">
        <h1>{t('The map could not be loaded')}</h1>
        <p>{t('Check your connection and try again.')}</p>
        <button type="button" onClick={() => window.location.reload()}>
          {t('Try again')}
        </button>
      </div>
    );
  });
