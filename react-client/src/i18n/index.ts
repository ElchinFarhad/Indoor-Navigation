/**
 * Languages of the interface.
 *
 * The English text is the key: `t('Start shopping')` returns the Italian text
 * when the language is Italian and a translation exists, and the English text
 * otherwise. Values in braces are filled in: `t('In {d} m', { d: 6 })`.
 *
 * The language is chosen from `?lang=` in the address (remembered afterwards),
 * else from an earlier choice, else from the phone's language. Changing it
 * reloads the page, so the rest of the app can treat it as a constant.
 */
import it from './it';

export type Lang = 'en' | 'it';
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'it', name: 'Italiano' },
];

const KEY = 'indoor-nav.lang';
const DICTIONARIES: { [lang: string]: { [text: string]: string } } = { it };

function detect(): Lang {
  const known = (v: string | null | undefined): Lang | null => (v === 'en' || v === 'it' ? v : null);
  try {
    const fromUrl = known(new URLSearchParams(window.location.search).get('lang'));
    if (fromUrl) {
      window.localStorage.setItem(KEY, fromUrl);
      return fromUrl;
    }
    const stored = known(window.localStorage.getItem(KEY));
    if (stored) return stored;
  } catch {
    /* no window / private mode */
  }
  const preferred = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return preferred.toLowerCase().startsWith('it') ? 'it' : 'en';
}

let lang: Lang = detect();

export function currentLang(): Lang {
  return lang;
}

/** BCP 47 tag for speech and number formatting. */
export function locale(): string {
  return lang === 'it' ? 'it-IT' : 'en-GB';
}

/** Switches the language and reloads the app. */
export function selectLang(next: Lang) {
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* private mode: the address parameter below still carries the choice */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('lang', next);
  window.location.assign(url.toString());
}

/** For tests: switch without reloading. */
export function setLangForTests(next: Lang) {
  lang = next;
}

export function t(text: string, params?: { [name: string]: string | number }): string {
  const dictionary = DICTIONARIES[lang];
  let out = (dictionary && dictionary[text]) || text;
  if (params) {
    for (const name of Object.keys(params)) out = out.split(`{${name}}`).join(String(params[name]));
  }
  return out;
}

/** True if the current language has its own text for this key. */
export function hasTranslation(text: string): boolean {
  return lang === 'en' || !!(DICTIONARIES[lang] && DICTIONARIES[lang][text]);
}

/** A field of venue data in the current language: `name_it` before `name`. */
export function localized(record: any, field: string): string | undefined {
  if (!record) return undefined;
  const own = record[`${field}_${lang}`];
  return own !== undefined && own !== '' ? own : record[field];
}

/** Singular or plural text by count; `{n}` is the count. */
export function plural(n: number, one: string, many: string, params?: { [name: string]: string | number }): string {
  return t(n === 1 ? one : many, { n, ...(params || {}) });
}
