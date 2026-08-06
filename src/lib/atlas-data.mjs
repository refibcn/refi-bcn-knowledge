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

/**
 * Fill for the comarca density layer. A single hue whose opacity carries the
 * count — density is one variable, so it gets one colour rather than the
 * six-way category palette. Distinct from the cohort comarca fill (#8B5A3C) so
 * the two overlays stay tellable apart.
 */
export const COMARCA_DENSITY_COLOR = "#3d5a80";

/**
 * Map an actor count onto a fill opacity, on a sqrt ramp.
 *
 * Barcelonès holds 57 of 79 placed actors while most comarques hold one, so a
 * linear ramp would render everything except Barcelonès invisible.
 * @param {number} count
 * @param {number} maxCount
 * @returns {number}
 */
export function densityOpacity(count, maxCount) {
  if (!(count > 0) || !(maxCount > 0)) return 0;
  const ratio = Math.sqrt(count / maxCount);
  return Math.round((0.1 + 0.24 * ratio) * 1000) / 1000;
}

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

/**
 * CRM `Area2` labels that name the same territory as a geojson `nom_comar`
 * value but spell it differently. Keys are lowercased Area2 options.
 *
 * Deliberately minimal. `Lluçanès` and `Moianès` are also CRM options with no
 * match, but they are genuinely absent from this geojson (both were carved out
 * of neighbouring comarques after it was cut), so aliasing them to anything
 * would place actors in the wrong territory. They are dropped instead.
 */
export const COMARCA_ALIASES = Object.freeze({
  aran: "Val d'Aran",
  "la selva": "Selva",
});

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
 * One comarca and the actors placed in it.
 * @typedef {object} ComarcaPlacement
 * @property {string} comarca  A `nom_comar` value from the atlas geojson.
 * @property {{name: string, category: string|null, tags: string[]}[]} actors
 */

/**
 * Build a lookup from a loose label to the canonical geojson comarca name.
 * @param {Iterable<string>} comarcaIndex
 * @returns {Map<string, string>}
 */
function comarcaLookup(comarcaIndex) {
  /** @type {Map<string, string>} */
  const lookup = new Map();
  for (const name of comarcaIndex ?? []) {
    const canonical = String(name).trim();
    if (canonical) lookup.set(canonical.toLowerCase(), canonical);
  }
  // Aliases only resolve to names the index actually contains, so a geojson
  // swap can never leave an alias pointing at a comarca that isn't drawn.
  for (const [alias, target] of Object.entries(COMARCA_ALIASES)) {
    const canonical = lookup.get(target.toLowerCase());
    if (canonical) lookup.set(alias, canonical);
  }
  return lookup;
}

/**
 * Place CRM actors on comarca polygons via their `Area2` multi-select.
 *
 * This is the geography the CRM actually has. `Area2`'s comarca options are the
 * same territorial divisions as the atlas geojson's `nom_comar` values, so the
 * two join by name. Province-level and `regional` values carry no polygon and
 * are dropped rather than guessed at — same discipline as the point path, which
 * drops records without coordinates.
 *
 * Pure: the caller supplies the comarca name set (read off the geojson at build
 * time), so this needs no filesystem or bundler access and is directly testable.
 *
 * @param {NormalizedRecord[]} records
 * @param {Iterable<string>} comarcaIndex  `nom_comar` values from the geojson.
 * @returns {ComarcaPlacement[]} Ranked by actor count desc, then comarca name.
 */
export function toComarcaPlacements(records, comarcaIndex) {
  const lookup = comarcaLookup(comarcaIndex);
  /** @type {Map<string, {name: string, category: string|null, tags: string[]}[]>} */
  const byComarca = new Map();

  for (const record of records ?? []) {
    const props = record?.properties ?? {};

    const name = String(props["Name"] ?? props["Title"] ?? "").trim();
    if (!name) continue;

    const raw = props["Area2"];
    if (raw === null || raw === undefined || raw === "") continue;
    const area2 = (Array.isArray(raw) ? raw : [raw])
      .map((v) => String(v).trim())
      .filter(Boolean);

    // A record can sit in several comarques; it is listed in each.
    const comarques = new Set();
    for (const value of area2) {
      const canonical = lookup.get(value.toLowerCase());
      if (canonical) comarques.add(canonical);
    }
    if (comarques.size === 0) continue;

    const tags = agencyValues(props);
    const actor = { name, category: categoryFor(tags), tags };
    for (const comarca of comarques) {
      const bucket = byComarca.get(comarca);
      if (bucket) bucket.push(actor);
      else byComarca.set(comarca, [actor]);
    }
  }

  return Array.from(byComarca, ([comarca, actors]) => ({
    comarca,
    actors: actors.sort((a, b) => a.name.localeCompare(b.name)),
  })).sort(
    (a, b) =>
      b.actors.length - a.actors.length || a.comarca.localeCompare(b.comarca),
  );
}

/**
 * Centroid of the largest ring in a (Multi)Polygon, as `[lng, lat]`.
 *
 * Used to put one count badge per comarca. Nine of the 50 geojson features
 * share a name with an exclave, so taking the largest ring rather than every
 * ring is what keeps Barcelonès from drawing two competing badges.
 *
 * Area and centroid come from the standard shoelace formulas; a degenerate
 * (zero-area) ring falls back to the mean of its vertices.
 *
 * @param {{type?: string, coordinates?: any} | null | undefined} geometry
 * @returns {[number, number] | null}
 */
export function largestRingCentroid(geometry) {
  const type = geometry?.type;
  if (type !== "Polygon" && type !== "MultiPolygon") return null;

  // Normalize both shapes to a list of polygons, each polygon a list of rings.
  const polygons =
    type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons)) return null;

  /** @type {number[][] | null} */
  let best = null;
  let bestArea = -1;
  for (const polygon of polygons) {
    const ring = polygon?.[0];
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const area = Math.abs(ringArea(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  if (!best) return null;

  const signed = ringArea(best);
  if (signed === 0) {
    const n = best.length;
    const sum = best.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [sum[0] / n, sum[1] / n];
  }

  let x = 0;
  let y = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const cross = best[j][0] * best[i][1] - best[i][0] * best[j][1];
    x += (best[j][0] + best[i][0]) * cross;
    y += (best[j][1] + best[i][1]) * cross;
  }
  return [x / (6 * signed), y / (6 * signed)];
}

/**
 * Signed area of a ring (shoelace). Sign encodes winding order.
 * @param {number[][]} ring
 * @returns {number}
 */
function ringArea(ring) {
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    total += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return total / 2;
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
