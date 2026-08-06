// Atlas CRM feed — turns ReFi BCN CRM actor records into map markers.
//
// `.mjs` + JSDoc rather than `.ts`, for the same reason as `kb.mjs`: the repo's
// test runner is plain `node --test tests/*.test.mjs`, which cannot import
// TypeScript. Keeping the mapper in .mjs lets it be unit-tested directly
// instead of only through a build.
//
// The Notion client this module fetches through IS TypeScript (`notion.ts`,
// ported from rc2), so it is pulled in with a *dynamic* import inside
// `fetchAtlasRecords()`. That keeps module load free of any TS import, so
// `node --test` can load this file to exercise the pure `toMarkers()`; the
// dynamic import only ever resolves under Vite during the Astro build.

/**
 * A record as normalized by `notion.ts`.
 * @typedef {object} NormalizedRecord
 * @property {string} id
 * @property {string} url
 * @property {string} createdTime
 * @property {string} lastEditedTime
 * @property {Record<string, any>} properties
 */

/**
 * One point on the atlas. Shape is deliberately minimal and is pinned by
 * `tests/atlas-data.test.mjs` — notably there is no Notion id, which is why
 * popup links go through `actorAnchor(name)`.
 * @typedef {object} AtlasMarker
 * @property {string} name
 * @property {number} lat
 * @property {number} lng
 * @property {string|null} category  One of AGENCY_PRECEDENCE, or null.
 * @property {string[]} tags         The record's raw agency values.
 */

/**
 * The D9 legend taxonomy, in precedence order — first match wins.
 *
 * These six strings are exactly the `Agency` multi-select options on the CRM
 * actors database, i.e. Giulio's `agency` vocabulary. `Agency` is multi-valued
 * (91 of 608 live records carry two or more), so a record has to be resolved to
 * a single legend bucket; the order below is that resolution, most specific
 * role first.
 *
 * This array is the single definition of the taxonomy: `toMarkers()` derives a
 * marker's category from it and `atlas.astro` renders the legend from it. Do
 * not restate the order anywhere else.
 * @type {readonly string[]}
 */
export const AGENCY_PRECEDENCE = Object.freeze([
  "funder",
  "public body",
  "network/ecosystem",
  "space",
  "org",
  "ind",
]);

/** Human-readable legend labels, keyed by the raw agency value. */
export const AGENCY_LABELS = Object.freeze({
  funder: "Funder",
  "public body": "Public body",
  "network/ecosystem": "Network / ecosystem",
  space: "Space",
  org: "Organization",
  ind: "Individual",
});

/**
 * Legend swatch / marker fill per agency value. Read by both the legend in
 * `atlas.astro` and the map layer (the colour is baked onto each GeoJSON
 * feature), so a swatch can never disagree with its markers.
 *
 * Deliberately avoids the two cohort-network hues already on the map
 * (#8B5A3C Miceli, #6B4EA3 Keras Buti) so the CRM layer stays visually
 * separable from the ported cohort markers.
 */
export const AGENCY_COLORS = Object.freeze({
  funder: "#b8860b",
  "public body": "#3d6b9e",
  "network/ecosystem": "#2e7d5b",
  space: "#c4622d",
  org: "#4a4a8f",
  ind: "#a8455f",
});

/** Fill for markers carrying no value from the taxonomy. */
export const UNCATEGORIZED_COLOR = "#8a8378";

/** Legend rows, in precedence order. The one place the legend is derived. */
export function legendEntries() {
  return AGENCY_PRECEDENCE.map((id) => ({
    id,
    label: /** @type {Record<string,string>} */ (AGENCY_LABELS)[id] ?? id,
    color:
      /** @type {Record<string,string>} */ (AGENCY_COLORS)[id] ??
      UNCATEGORIZED_COLOR,
  }));
}

/** Section id in `src/data/databases.yaml` that holds the CRM actors. */
const ACTORS_SECTION = "actors";

/** Catalunya-generous sanity bounds; anything outside is bad data, not a place. */
const LAT_RANGE = [-90, 90];
const LNG_RANGE = [-180, 180];

/**
 * Coerce a Notion property to a finite number in range, or null.
 * @param {unknown} value
 * @param {number[]} range
 * @returns {number|null}
 */
function toCoord(value, range) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < range[0] || n > range[1]) return null;
  return n;
}

/**
 * Read the record's agency values.
 *
 * `Agency` is the live CRM property; `Tags` is accepted as a fallback because
 * `databases.yaml` documents the actors section as exposing "Type/Tags" and the
 * mapper should not care which of the two a given export carries.
 * @param {Record<string, any>} props
 * @returns {string[]}
 */
function agencyValues(props) {
  const raw = props["Agency"] ?? props["Tags"];
  if (raw === null || raw === undefined || raw === "") return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((v) => String(v).trim()).filter(Boolean);
}

/**
 * Resolve multi-valued agency to one legend bucket by AGENCY_PRECEDENCE.
 * Returns null when the record carries no value from the taxonomy — the atlas
 * shows that as "uncategorised" rather than guessing a bucket.
 * @param {string[]} values
 * @returns {string|null}
 */
export function categoryFor(values) {
  const present = new Set(values.map((v) => v.toLowerCase()));
  for (const candidate of AGENCY_PRECEDENCE) {
    if (present.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Stable in-page anchor for an actor, derived from its name.
 *
 * Used by BOTH `atlas.astro` (popup link target) and `organizations.astro`
 * (card id) so the two cannot drift. Name-derived rather than id-derived
 * because AtlasMarker carries no Notion id.
 * @param {string} name
 * @returns {string}
 */
export function actorAnchor(name) {
  const slug = String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `actor-${slug}`;
}

/**
 * Map CRM records to atlas markers.
 *
 * Pure: no I/O, no Notion client. Records without usable geo or without a name
 * are dropped silently — that is the expected steady state, since most CRM
 * actors have never been geocoded.
 * @param {NormalizedRecord[]} records
 * @returns {AtlasMarker[]}
 */
export function toMarkers(records) {
  /** @type {AtlasMarker[]} */
  const markers = [];

  for (const record of records ?? []) {
    const props = record?.properties ?? {};

    const name = String(props["Name"] ?? props["Title"] ?? "").trim();
    if (!name) continue;

    const lat = toCoord(props["Lat"] ?? props["Latitude"], LAT_RANGE);
    const lng = toCoord(props["Lng"] ?? props["Longitude"], LNG_RANGE);
    if (lat === null || lng === null) continue;

    const tags = agencyValues(props);
    markers.push({ name, lat, lng, category: categoryFor(tags), tags });
  }

  return markers;
}

/**
 * Fetch the CRM actor records at build time.
 *
 * Resolves the database id from the `actors` section of
 * `src/data/databases.yaml` rather than hardcoding it, and reuses
 * `fetchDatabaseRecords` from `notion.ts` so there is exactly one paginating
 * Notion fetch in the codebase.
 * @returns {Promise<NormalizedRecord[]>}
 */
export async function fetchAtlasRecords() {
  // Dynamic so that plain `node --test` never has to resolve a .ts specifier.
  const { getSection, fetchDatabaseRecords } = await import("./notion");
  const section = getSection(ACTORS_SECTION);
  if (!section.database_id) {
    throw new Error(
      `Section "${ACTORS_SECTION}" in src/data/databases.yaml has no database_id.`,
    );
  }
  return fetchDatabaseRecords(section.database_id);
}
