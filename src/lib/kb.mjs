// Loader for the ReFi BCN typed knowledge store: kb/<schema>/<slug>.md in
// THIS repo — one markdown file per object, frontmatter = the object's fields,
// body = its `notes` field. The folder carries the schema, the filename the
// slug; there are no `schema:`/`id:` keys in frontmatter. The parse contract
// (and the migration that proved it lossless 422/422) is documented in
// scripts/migrate-kb-to-md.mjs and kb/README.md. Keep pure + dependency-light.
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

// ── Path resolution: bundled vs unbundled ─────────────────────────────────
// Read this before adding another consumer of the store.
//
// This module runs in two contexts that do NOT agree on `import.meta.url`:
//
//   1. Plain Node — `node --test`, `scripts/*.mjs`. Nothing is bundled, so
//      `import.meta.url` is this source file and relative URLs off it are right.
//   2. Astro build — Vite emits `src/lib` into `dist/`, so `import.meta.url` is
//      the *emitted chunk*, not this file. Verified empirically: a component
//      importing this module reported `import.meta.url` =
//      `dist/pages/<page>.astro.mjs`. That is the same trap that produced the
//      `ENOENT dist/data/site.yaml` failure and pushed `src/lib/site.ts` to a
//      Vite `?raw` bundle-time import.
//
// `?raw` cannot solve it here: the store is ~1 MB across 422 markdown files,
// and it must stay readable by unbundled scripts too.
//
// So: anchor every path on the repo root, located by walking up from wherever
// this module is executing until a `package.json` appears. That walk lands on
// the repo root from `src/lib/` and from any `dist/**` chunk alike, so it does
// not care how deep Vite buries the emitted code.
//
// Do NOT go back to `new URL("../../kb/", import.meta.url)`. It would happen
// to produce the right directory only while `dist/pages/` sits at the same
// depth as `src/lib/`; any change to Vite's chunk layout silently repoints it
// at a directory that does not exist.
//
// fileURLToPath, not .pathname — the checkout path contains spaces ("03 Libraries").
function findRepoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        "kb.mjs: no package.json found above " + fileURLToPath(import.meta.url),
      );
    }
    dir = parent;
  }
  return dir;
}

const REPO_ROOT = findRepoRoot();

// The store lives in this repo since the 2026-08-12 migration (it used to be
// parent-workspace YAML at ../../data/kb/, with a committed fallback for
// standalone clones — both retired: a clone now carries the store).
const DEFAULT_KB_DIR = resolve(REPO_ROOT, "kb");

/** Which store to read: the KB_DIR env override, else the in-repo kb/. */
export function resolveKbDir() {
  // Normalize the env override: a consumer comparing resolved paths (the way
  // the retired exporter guarded against reading its own output) must not be
  // bypassable by a relative path, a trailing slash, or a symlinked prefix
  // (/tmp vs /private/tmp). Resolve so any such guard holds.
  if (process.env.KB_DIR) return canonicalize(process.env.KB_DIR);
  return DEFAULT_KB_DIR;
}

/** Absolute + symlink-resolved when the path exists; absolute otherwise. */
function canonicalize(p) {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs; // not created yet — absolute is the best we can do
  }
}

// ── Types ────────────────────────────────────────────────────────────────
// JSDoc only: this file stays plain ESM and `checkJs` is off, so nothing here
// is type-checked. The annotations exist so `.astro` consumers — which ARE
// checked, by `npm run check` — get a real shape instead of `any`/`never`.
/**
 * @typedef {object} KbObject
 * @property {string} id           `<schema>/<slug>`
 * @property {string} schema
 * @property {string} slug
 * @property {string} title
 * @property {string} subtype
 * @property {string} domain
 * @property {string} maturity
 * @property {boolean} high_risk
 * @property {string} summary
 * @property {string} origin
 * @property {Record<string, any>} raw  The untouched YAML entry.
 */

/**
 * One md file → the entry object it encodes. This mirrors — exactly — the
 * body-reattachment rule the migration proved lossless (see the header of
 * scripts/migrate-kb-to-md.mjs):
 *
 *   1. The file starts `---\n`; the closing delimiter is the FIRST `\n---\n`
 *      after it (a later `---` line belongs to the body).
 *   2. body = everything after the closing `\n---\n`.
 *   3. Strip ONE leading `\n` from body (the writer's separator blank line),
 *      then ALL trailing whitespace.
 *   4. entry = { ...frontmatter, ...(body !== "" ? { notes: body } : {}) }.
 *
 * A malformed file throws, naming it — a store file that silently parsed to
 * nothing would vanish an object from every count on the site.
 *
 * @param {string} content
 * @param {string} label  `<schema>/<file>` for the error message.
 * @returns {Record<string, any>}
 */
function parseMdEntry(content, label) {
  if (!content.startsWith("---\n")) {
    throw new Error(`kb.mjs: ${label}: missing opening \`---\` delimiter`);
  }
  const close = content.indexOf("\n---\n", 3);
  if (close === -1) {
    throw new Error(`kb.mjs: ${label}: missing closing \`---\` delimiter`);
  }
  const frontmatter = yaml.load(content.slice(4, close + 1)) ?? {};
  let body = content.slice(close + 5);
  if (body.startsWith("\n")) body = body.slice(1); // ONE leading blank line
  body = body.replace(/\s+$/u, ""); // ALL trailing whitespace
  return { ...frontmatter, ...(body !== "" ? { notes: body } : {}) };
}

/** @returns {KbObject[]} */
export function loadKb(kbDir = resolveKbDir()) {
  // Folders = schemas. Root-level files (README.md, the *.base Obsidian
  // views) are not directories, so they never enter the walk.
  const schemas = readdirSync(kbDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  /** @type {KbObject[]} */
  const objects = [];
  for (const schema of schemas) {
    const files = readdirSync(join(kbDir, schema)).filter(
      (f) => f.endsWith(".md") && f !== "README.md",
    );
    for (const file of files) {
      const slug = file.replace(/\.md$/, "");
      const o = parseMdEntry(
        readFileSync(join(kbDir, schema, file), "utf8"),
        `${schema}/${file}`,
      );
      objects.push({
        id: `${schema}/${slug}`,
        schema,
        slug,
        title: o.title || slug,
        subtype:
          o.type ||
          o.page_type ||
          o.resource_type ||
          o.signal_type ||
          o.tier ||
          "",
        domain: o.domain || "",
        maturity:
          o.maturity || (schema === "public-use-boundary" ? "boundary" : "raw"),
        high_risk: Boolean(o.high_risk) || o.tier === "public-with-caveat",
        summary:
          o.summary ||
          o.short_description ||
          o.claim ||
          o.interpretation ||
          o.consent_note ||
          o.what_it_curates ||
          "",
        origin: o.provenance?.origin || o.source_lineage || o.url || "",
        raw: o,
      });
    }
  }
  objects.sort(
    (a, b) =>
      a.schema.localeCompare(b.schema) || a.title.localeCompare(b.title),
  );
  return objects;
}

/** @param {KbObject[]} objects */
export function facets(objects) {
  return {
    schemas: [...new Set(objects.map((o) => o.schema))].sort(),
    domains: [...new Set(objects.map((o) => o.domain).filter(Boolean))].sort(),
    highRisk: objects.filter((o) => o.high_risk).length,
  };
}

// Graph model: nodes = objects; edges = same-source siblings + shared-concept pairs.
// Same-source edges first (strongest signal), concept edges fill up to the cap.
/** @param {KbObject[]} objects */
export function graphData(objects) {
  const seen = new Set();
  /** @type {[number, number][]} */
  const links = [];
  const push = (a, b) => {
    if (a === b) return;
    const lo = Math.min(a, b),
      hi = Math.max(a, b);
    const k = `${lo}-${hi}`;
    if (!seen.has(k) && links.length < 4000) {
      seen.add(k);
      links.push([lo, hi]);
    }
  };

  const bySource = new Map();
  objects.forEach((o, i) => {
    const src = o.raw.work_order || o.origin;
    if (!src) return;
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(i);
  });
  for (const g of bySource.values()) {
    if (g.length < 2) continue;
    if (g.length <= 6) {
      for (let i = 0; i < g.length; i++)
        for (let j = i + 1; j < g.length; j++) push(g[i], g[j]);
    } else {
      for (let j = 1; j < g.length; j++) push(g[0], g[j]);
    }
  }

  const byConcept = new Map();
  objects.forEach((o, i) => {
    for (const c of o.raw.related_concepts ?? []) {
      const k = String(c).trim().toLowerCase();
      if (!k) continue;
      if (!byConcept.has(k)) byConcept.set(k, []);
      byConcept.get(k).push(i);
    }
  });
  for (const g of byConcept.values()) {
    if (g.length < 2 || g.length > 8) continue; // >8 objects = concept too generic to draw
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) push(g[i], g[j]);
  }

  const degree = new Array(objects.length).fill(0);
  for (const [a, b] of links) {
    degree[a]++;
    degree[b]++;
  }
  return {
    nodes: objects.map((o, i) => ({
      i,
      schema: o.schema,
      hr: o.high_risk,
      degree: degree[i],
    })),
    links,
  };
}

// ── Publication filter (public lens) — FAIL-CLOSED ────────────────────────
// An object renders publicly only if every rule passes; unknown states deny.
// The `publish: true` in-scope marker + PUBLIC_TIERS vocabulary are set at
// review / D0 ratification — until then this correctly returns zero objects.
const OK_MATURITY = new Set(["reviewed", "published"]);
const PUBLIC_TIERS = new Set(["public"]);

/** @param {KbObject} o */
function pairKeys(o) {
  /** @type {string[]} */
  const keys = [];
  if (o.raw.work_order) keys.push(`wo:${o.raw.work_order}`);
  if (o.origin) keys.push(`or:${o.origin}`);
  return keys;
}

/**
 * @param {KbObject[]} objects
 * @returns {KbObject[]}
 */
export function publishableKb(objects) {
  /** @type {Map<string, KbObject[]>} */
  const boundaryIndex = new Map();
  for (const b of objects) {
    if (b.schema !== "public-use-boundary") continue;
    for (const k of pairKeys(b)) {
      if (!boundaryIndex.has(k)) boundaryIndex.set(k, []);
      boundaryIndex.get(k).push(b);
    }
  }
  return objects.filter((o) => {
    if (o.schema === "public-use-boundary") return false; // governance metadata, never a page
    if (o.raw.publish !== true) return false; // in-scope marker (review-time)
    if (!OK_MATURITY.has(o.maturity)) return false;
    if (o.raw.ai_assisted === true) return false; // promotion must clear this
    const paired = pairKeys(o).flatMap((k) => boundaryIndex.get(k) ?? []);
    for (const b of paired) if (!PUBLIC_TIERS.has(b.raw.tier)) return false;
    if (o.high_risk && !paired.some((b) => PUBLIC_TIERS.has(b.raw.tier)))
      return false;
    return true;
  });
}

// ── Connections (link graph for the KB app) ──────────────────────────────
// Resolves each object's `related_concepts` (a list of TITLES) to indices
// WITHIN the given set, plus reverse backlinks and same-source siblings.
// Resolution is scoped to `objects`, so in the public lens (fed publishableKb)
// a link to an unpublished title stays `unresolved` — never becomes a path.
const normTitle = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");

/**
 * @param {KbObject[]} objects
 * @returns {{ out: number[][], unresolved: string[][], backlinks: number[][], siblings: number[][] }}
 */
export function connections(objects) {
  /** @type {Map<string, number>} */
  const byTitle = new Map();
  /** @type {Map<string, number>} */
  const bySlug = new Map();
  objects.forEach((o, i) => {
    const t = normTitle(o.title);
    if (!byTitle.has(t)) byTitle.set(t, i); // first wins on dup titles
    if (!bySlug.has(o.slug)) bySlug.set(o.slug, i);
  });

  /** @type {number[][]} */
  const out = objects.map(() => []);
  /** @type {string[][]} */
  const unresolved = objects.map(() => []);
  /** @type {number[][]} */
  const backlinks = objects.map(() => []);

  objects.forEach((o, i) => {
    const seen = new Set();
    for (const raw of o.raw.related_concepts ?? []) {
      const label = String(raw).trim();
      if (!label) continue;
      let j = byTitle.get(normTitle(label));
      if (j === undefined) j = bySlug.get(label);
      if (j === undefined || j === i) {
        if (j === undefined) unresolved[i].push(label);
        continue;
      }
      if (seen.has(j)) continue;
      seen.add(j);
      out[i].push(j);
      backlinks[j].push(i);
    }
  });

  // Same work-order / same-origin provenance siblings (excludes self + concept links).
  const bySource = new Map();
  objects.forEach((o, i) => {
    const src = o.raw.work_order || o.origin;
    if (!src) return;
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src).push(i);
  });
  const siblings = objects.map((o, i) => {
    const src = o.raw.work_order || o.origin;
    const group = (src && bySource.get(src)) || [];
    const linked = new Set(out[i]);
    return group.filter((j) => j !== i && !linked.has(j));
  });

  return { out, unresolved, backlinks, siblings };
}

// ── Source containers ────────────────────────────────────────────────────
// Groups every object under the source system it came from. The containers
// are the `source-system` schema entries; the membership test is a prefix
// match on the object's recorded origin.
//
// This is the seam under /sources and, downstream, under the archive-ready
// verdict for an upstream repo. Two failure modes have to stay loud:
//
//   1. WRONG container. Cards nest — `refi-bcn-os-operations` lives inside
//      `refi-bcn` — so matching is LONGEST-PREFIX-WINS, not first-match.
//      First-match would swallow every operations object into the parent repo.
//   2. NO container. Anything that matches nothing goes to `unattributed`,
//      which is always present even when empty. It is the canary: a non-zero
//      count means objects exist that no container page would ever show.
//
// Nothing here mutates the objects; containers hold the same references.

export const UNATTRIBUTED = "unattributed";

/** Read a field off a card in either shape: a loadKb-normalized object (fields
 *  hoisted, original under `raw`) or a plain YAML entry. */
function cardField(card, name) {
  return card?.[name] ?? card?.raw?.[name];
}

/**
 * The origin prefixes a card claims, in precedence order:
 *
 *   1. An explicit `origin_prefixes:` list on the card — used verbatim. It is
 *      authoritative because derivation cannot know every notation (e.g.
 *      refibcn-site: the repo is `refibcn.github.io`, the working copy is
 *      `repos/refibcn-site/`).
 *   2. Otherwise derived from `url`: the url with a single trailing slash,
 *      plus — for GitHub urls — the workspace-relative `repos/<repo>/` form,
 *      because the store records both notations (loadKb falls back
 *      provenance.origin → source_lineage → url).
 *   3. Neither → no prefixes. The container still exists, just empty.
 *
 * The trailing slash is load-bearing: without it `…/ReFi-Barcelona` would also
 * match a sibling repo like `…/ReFi-Barcelona-archive`.
 *
 * @param {Record<string, any> | null | undefined} card
 * @returns {string[]}
 */
export function cardOriginPrefixes(card) {
  const explicit = cardField(card, "origin_prefixes");
  if (Array.isArray(explicit)) {
    return explicit.filter((p) => typeof p === "string" && p.length > 0);
  }
  const url = cardField(card, "url");
  if (typeof url !== "string" || !url) return [];
  const prefixes = [url.endsWith("/") ? url : `${url}/`];
  const repo = /^https?:\/\/github\.com\/[^/]+\/([^/?#]+)/i.exec(url);
  if (repo) prefixes.push(`repos/${repo[1]}/`);
  return prefixes;
}

/** The string a container match is tested against. The store records two
 *  shapes: `provenance.origin` (most objects) and a bare `source_lineage`
 *  (public-use-boundary records, which carry no provenance object at all).
 *  Missing the second silently inflates `unattributed`. `origin` is the
 *  loadKb-normalized fallback, which also covers hand-built objects. */
function originKey(o) {
  const key =
    o?.raw?.provenance?.origin || o?.raw?.source_lineage || o?.origin || "";
  return typeof key === "string" ? key : "";
}

/** Map → key-sorted plain object, so the serialized container is byte-stable
 *  across runs. Tallies accumulate in a Map, never in an object literal: a
 *  bucket named `__proto__` (or any other Object.prototype key) assigned onto
 *  a literal would silently fail to become an own property, i.e. vanish from
 *  the count. Unlikely from a controlled vocabulary — but a tally that loses
 *  objects without saying so is the exact failure this seam must not have. */
export function sortedCounts(counts) {
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * @typedef {object} SourceContainer
 * @property {string} id       The card slug, or "unattributed".
 * @property {string} title
 * @property {Record<string, any> | null} card  null for "unattributed".
 * @property {KbObject[]} objects
 * @property {number} objects_total  `objects.length` — as a NAMED field. Every
 *   page reads the count here rather than off the array, a contract inherited
 *   from the retired committed-summary path (whose rows carried `objects: []`)
 *   and kept because a named count cannot be accidentally read off a filtered
 *   or blanked array.
 * @property {Record<string, number>} by_maturity  Unset maturity buckets as "unset".
 * @property {Record<string, number>} by_schema
 * @property {number} high_risk_count  Uses the loadKb-normalized `high_risk`,
 *   so it agrees with facets().highRisk rather than with the raw store flag.
 * @property {number} unresolved_high_risk  High-risk objects still at maturity
 *   "raw". THE canonical definition — archiveReady() consumes this number and
 *   must never recompute it from `objects`: a verdict recomputing it from a
 *   row whose listing is empty or partial would turn "I cannot tell" into
 *   "nothing to review". See archive-ready.mjs.
 */

/** @returns {SourceContainer} */
function finishContainer(id, title, card, objects) {
  /** @type {Map<string, number>} */
  const by_maturity = new Map();
  /** @type {Map<string, number>} */
  const by_schema = new Map();
  let high_risk_count = 0;
  let unresolved_high_risk = 0;
  for (const o of objects) {
    // Explicit bucket for an unset maturity — never let `undefined` become a
    // property name, and never let it vanish from the tally.
    const m = o?.maturity || "unset";
    by_maturity.set(m, (by_maturity.get(m) ?? 0) + 1);
    const s = o?.schema || "unset";
    by_schema.set(s, (by_schema.get(s) ?? 0) + 1);
    if (o?.high_risk) {
      high_risk_count += 1;
      // Same tally loop as high_risk_count on purpose: the two numbers are read
      // side by side on the container page and in the archive verdict, and a
      // second pass elsewhere is a second definition waiting to drift.
      if (o.maturity === "raw") unresolved_high_risk += 1;
    }
  }
  return {
    id,
    title,
    card,
    objects,
    objects_total: objects.length,
    by_maturity: sortedCounts(by_maturity),
    by_schema: sortedCounts(by_schema),
    high_risk_count,
    unresolved_high_risk,
  };
}

/**
 * @param {KbObject[]} objects  The full set. `source-system` entries in it are
 *   the container definitions, not container contents — they are excluded from
 *   membership and from every tally.
 * @param {Record<string, any>[]} [cards]  Defaults to the `source-system`
 *   entries found in `objects`.
 * @returns {SourceContainer[]}  Most-populated first, id-ascending on ties,
 *   `unattributed` always last and always present.
 */
export function sourceContainers(objects, cards) {
  const objs = Array.isArray(objects) ? objects : [];
  const cardList = Array.isArray(cards)
    ? cards
    : objs.filter((o) => o?.schema === "source-system");

  /** @type {Map<string, { title: string, card: Record<string, any>, objects: KbObject[] }>} */
  const containers = new Map();
  for (const card of cardList) {
    const id = String(cardField(card, "slug") ?? card?.id ?? "");
    if (!id || containers.has(id)) continue;
    containers.set(id, {
      title: String(cardField(card, "title") || id),
      card,
      objects: [],
    });
  }

  /** @type {KbObject[]} */
  const orphans = [];

  // Every (containerId, prefix) pair, longest prefix first. Sorting by length
  // is what makes nested cards resolve to the deepest one; the id/prefix
  // tiebreaks only exist so equal-length prefixes resolve deterministically.
  /** @type {[string, string][]} */
  const pairs = [];
  for (const [id, c] of containers) {
    for (const p of cardOriginPrefixes(c.card)) pairs.push([id, p]);
  }
  pairs.sort(
    (a, b) =>
      b[1].length - a[1].length ||
      a[0].localeCompare(b[0]) ||
      a[1].localeCompare(b[1]),
  );

  for (const o of objs) {
    if (o?.schema === "source-system") continue; // a card, not contents
    const key = originKey(o);
    const hit = key ? pairs.find(([, p]) => key.startsWith(p)) : undefined;
    if (hit) containers.get(hit[0]).objects.push(o);
    else orphans.push(o);
  }

  const list = [...containers]
    .map(([id, c]) => finishContainer(id, c.title, c.card, c.objects))
    .sort(
      (a, b) => b.objects.length - a.objects.length || a.id.localeCompare(b.id),
    );
  list.push(finishContainer(UNATTRIBUTED, "Unattributed", null, orphans));
  return list;
}

// ── Ingest disposition ───────────────────────────────────────────────────
// How many FILES of a source have been ingested / merged / excluded / are
// still pending, derived from the workspace batch rosters by
// `npm run derive:disposition` and committed so a standalone clone renders.

const DISPOSITION_FILE = resolve(
  REPO_ROOT,
  "src",
  "data",
  "sources-disposition.json",
);

/** @type {Map<string, Record<string, any>>} */
const dispositionCache = new Map();

/**
 * @typedef {object} Disposition
 * @property {string} batch
 * @property {string} source_card
 * @property {string} status
 * @property {number} files_total
 * @property {number} ingested
 * @property {number} merged
 * @property {number} excluded
 * @property {number} pending
 * @property {number} work_orders_prepared  NOT the file count — one file can
 *   produce several work orders (batch-1: 93 orders from 88 files).
 * @property {{ reason: string, files: number, file?: string }[]} excluded_reasons
 *   `file` is set only on post-hoc exclusions — single files the original
 *   triage never noticed, recorded on the roster after the fact.
 */

/**
 * @param {string} containerId
 * @param {string} [file]
 * @returns {Disposition | null}  null means "this source has no batch roster"
 *   (e.g. notion-refi-bcn, whose content is not files at all) — which is a
 *   different statement from a batch reporting zero files, and renders
 *   differently. A MISSING disposition file throws rather than degrading every
 *   container to null: a silently absent disposition would read as "nothing to
 *   ingest" and could authorise archiving a source that was never processed.
 */
export function disposition(containerId, file = DISPOSITION_FILE) {
  if (!dispositionCache.has(file)) {
    if (!existsSync(file)) {
      throw new Error(
        `kb.mjs: missing ${file}. It is a committed artifact — run ` +
          "`npm run derive:disposition` inside a refi-bcn-os checkout.",
      );
    }
    dispositionCache.set(file, JSON.parse(readFileSync(file, "utf8")));
  }
  const sources = dispositionCache.get(file).sources;
  // hasOwn, not a bare index: JSON.parse gives an Object.prototype-backed
  // object, so `sources["constructor"]` would hand back a function instead of
  // null for a container that has no roster.
  if (!sources || !Object.hasOwn(sources, containerId)) return null;
  return sources[containerId];
}
