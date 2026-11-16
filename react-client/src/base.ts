/** Path the app is served from, without a trailing slash ("" at the root of a domain). */
export const BASE_PATH: string = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
