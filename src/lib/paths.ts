/** URL helpers.
 *
 * `astro.config.mjs` deliberately sets no `base` (see README, "Pre-DNS URL
 * caveat"), so today `BASE_URL` is just "/". Everything still routes through
 * `withBase()` so that reversing that decision stays a one-line config change
 * rather than a sweep through every component.
 */

/** The site base, always with exactly one trailing slash. */
export const base: string = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/**
 * Join a root-relative path onto the site base.
 *
 * `withBase()` → the site root. `withBase("knowledge/")` → "/knowledge/".
 * Leading slashes on the argument are tolerated and stripped.
 */
export function withBase(pathname = ""): string {
  return `${base}${pathname.replace(/^\/+/, "")}`;
}
