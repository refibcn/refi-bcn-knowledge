// Loader for the refi-bcn-os KMS typed store (data/kb/<schema>.yaml).
// Ported from repos/refibcn-site — keep pure + dependency-light.
// Data path: this repo lives at repos/refi-bcn-knowledge inside the refi-bcn-os
// checkout, so the workspace store is two levels up at ../../data/kb/.
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
// `?raw` cannot solve it here: the store is ~1 MB of YAML across 9 files that
// live OUTSIDE this repo, and it must stay readable by unbundled scripts too.
//
// So: anchor every path on the repo root, located by walking up from wherever
// this module is executing until a `package.json` appears. That walk lands on
// the repo root from `src/lib/` and from any `dist/**` chunk alike, so it does
// not care how deep Vite buries the emitted code.
//
// Do NOT go back to `new URL("../../../../data/kb/", import.meta.url)`. It
// happens to produce the right directory today only because `dist/pages/` sits
// at the same depth as `src/lib/`; any change to Vite's chunk layout silently
// repoints it at a directory that does not exist.
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

// The workspace KMS store, present only inside a refi-bcn-os checkout.
const DEFAULT_KB_DIR = resolve(REPO_ROOT, "..", "..", "data", "kb");

export function loadKb(kbDir = process.env.KB_DIR ?? DEFAULT_KB_DIR) {
  const schemas = readdirSync(kbDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""));
  const objects = [];
  for (const schema of schemas) {
    const doc = yaml.load(readFileSync(join(kbDir, `${schema}.yaml`), "utf8"));
    for (const [slug, o] of Object.entries(doc?.entries ?? {})) {
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

export function facets(objects) {
  return {
    schemas: [...new Set(objects.map((o) => o.schema))].sort(),
    domains: [...new Set(objects.map((o) => o.domain).filter(Boolean))].sort(),
    highRisk: objects.filter((o) => o.high_risk).length,
  };
}

// Graph model: nodes = objects; edges = same-source siblings + shared-concept pairs.
// Same-source edges first (strongest signal), concept edges fill up to the cap.
export function graphData(objects) {
  const seen = new Set();
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

function pairKeys(o) {
  const keys = [];
  if (o.raw.work_order) keys.push(`wo:${o.raw.work_order}`);
  if (o.origin) keys.push(`or:${o.origin}`);
  return keys;
}

export function publishableKb(objects) {
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

export function connections(objects) {
  const byTitle = new Map();
  const bySlug = new Map();
  objects.forEach((o, i) => {
    const t = normTitle(o.title);
    if (!byTitle.has(t)) byTitle.set(t, i); // first wins on dup titles
    if (!bySlug.has(o.slug)) bySlug.set(o.slug, i);
  });

  const out = objects.map(() => []);
  const unresolved = objects.map(() => []);
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
