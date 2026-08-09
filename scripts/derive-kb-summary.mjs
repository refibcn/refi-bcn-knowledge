// Derives a committed AGGREGATE summary of the KMS store into
// src/data/kb-summary.json, so a standalone clone can render container and
// knowledge-lens *summaries* without the store.
//
// Why this exists
// ---------------
// The store (refi-bcn-os/data/kb/) lives OUTSIDE this repo. GitHub Actions
// clones this repo standalone, so `resolveKbDir()` falls back to the committed
// public subset at data/kb-public/ — which holds exactly one tracked file, a
// .gitkeep. The consequence, measured on a real clone before this script
// existed: /sources rendered "Sources 0 · Objects 0", /sources/<id> pages were
// never generated at all (the container cards are themselves `source-system`
// entries in the store, so with no store there are no containers), and
// /knowledge read 0 ingested / 0 in review.
//
// `npm run export:public-kb` cannot fix that. It exports publishableKb(), which
// is 0 objects by design until human review promotes them — correct fail-closed
// behaviour that must not be weakened to make a page look populated.
//
// So: the same pattern as src/data/sources-disposition.json — derived from the
// workspace, committed, read when the store is absent. Decision by Luiz,
// 2026-08-10. It finishes DC-3 as intended: the public build renders container
// SUMMARIES (counts, status, disposition, card) and zero object bodies.
//
// What may go in here
// -------------------
// AGGREGATES ONLY, plus the `source-system` card, which is org metadata already
// rendered publicly by design (steward, url, what_it_curates, container_role,
// corpus_path, signoff, archived_at, …). NO object titles, bodies, slugs or
// origins. `assertNoObjectLeak()` below enforces that against the real object
// set rather than trusting this comment.
//
// This script is never bundled (plain Node only), so `import.meta.url` is safe
// here — unlike src/lib/kb.mjs, which Vite emits into dist/. See the path
// resolution note at the top of src/lib/kb.mjs before copying this pattern.
// fileURLToPath, not .pathname — the checkout path contains spaces.
import { realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadKb,
  facets,
  publishableKb,
  sourceContainers,
  resolveKbDir,
  PUBLIC_KB_DIR,
} from "../src/lib/kb.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The committed output that src/lib/kb-summary.mjs reads. */
export const OUT_FILE = resolve(REPO_ROOT, "src", "data", "kb-summary.json");

export const GENERATED_COMMENT =
  "GENERATED — do not edit by hand. Written by `npm run derive:kb-summary` " +
  "from the refi-bcn-os workspace store (data/kb/). AGGREGATES ONLY: counts and " +
  "the source-system cards, never object titles, bodies, slugs or origins. " +
  "Re-run after every ingest batch, alongside `npm run derive:disposition`.";

/** Container keys the summary is allowed to carry. Anything else is a bug in
 *  this script, not a field to quietly pass through — the whole value of the
 *  artifact is that a reader can see it holds no content. */
const CONTAINER_KEYS = [
  "id",
  "title",
  "card",
  "objects_total",
  "by_schema",
  "by_maturity",
  "high_risk_count",
  "unresolved_high_risk",
];

/**
 * The card, flattened exactly the way sourcesViewModel() flattens the live one —
 * raw YAML entry underneath, loadKb-normalized fields on top — minus `raw`
 * itself, which would just duplicate the entry. Flattening HERE means the
 * summary path and the store path hand downstream code the same object shape,
 * so nothing after this point has to know which path it came from.
 *
 * @param {Record<string, any> | null | undefined} card
 */
function flattenCard(card) {
  if (!card) return null;
  const { raw, ...rest } = card;
  return { ...(raw ?? {}), ...rest };
}

/**
 * Refuse to emit anything that carries an object's identity.
 *
 * The probe is COMPOUND SLUGS — the kebab-case ids with a hyphen in them, which
 * are unambiguous identifiers rather than ordinary words — matched on
 * alphanumeric boundaries and case-sensitively.
 *
 * Each of those qualifiers was earned by a false positive on the first run:
 *
 *   - single-word slugs collide inside ordinary prose. `resource/celo` is a
 *     substring of "Bar·celo·na", which appears in every card that names the
 *     ReFi-Barcelona repo.
 *   - object TITLES collide with card titles legitimately: an object is titled
 *     "ReFi Barcelona", and so is a source. Title matching cannot distinguish a
 *     leak from a shared proper noun, so it is not used.
 *   - case matters: `repos/ReFi-Barcelona/` in `origin_prefixes` is not the slug
 *     `refi-barcelona`.
 *
 * A guard that cries wolf gets suppressed, so it is deliberately narrow here and
 * paired with the structural key/value assertions in deriveKbSummary(), which is
 * where "no object listings" is actually enforced.
 *
 * @param {string} json  The serialized summary.
 * @param {import("../src/lib/kb.mjs").KbObject[]} objects
 */
export function assertNoObjectLeak(json, objects) {
  /** @type {string[]} */
  const hits = [];
  for (const o of objects) {
    if (o.schema === "source-system") continue; // the cards ARE the summary
    if (!o.slug || !o.slug.includes("-")) continue;
    const escaped = o.slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(json)) {
      hits.push(`slug ${o.schema}/${o.slug}`);
    }
  }
  if (hits.length) {
    throw new Error(
      `derive-kb-summary: the summary carries object-level content — ` +
        `${hits.length} hit(s), first: ${hits[0]}. This artifact is committed and ` +
        "published; it must hold aggregates and source cards only.",
    );
  }
}

/** Card values must stay flat: scalars, arrays of scalars, or a one-level map of
 *  scalars (`signoff: {date, by}`). Nothing deeper. A nested structure in a card
 *  is how an object listing would arrive here without tripping the key
 *  allowlist, and the card is copied verbatim from YAML — so this is the check
 *  that keeps "verbatim" safe as cards grow fields nobody reviewed here. */
function assertFlatCard(id, card) {
  const scalar = (v) =>
    v === null || ["string", "number", "boolean"].includes(typeof v);
  for (const [k, v] of Object.entries(card ?? {})) {
    if (scalar(v)) continue;
    if (Array.isArray(v) && v.every(scalar)) continue;
    if (
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.values(v).every(scalar)
    )
      continue;
    throw new Error(
      `derive-kb-summary: container "${id}" card field \`${k}\` is nested — ` +
        "the summary carries flat card metadata only, never structured content.",
    );
  }
}

/**
 * @param {import("../src/lib/kb.mjs").KbObject[]} [objects]  Defaults to the store
 *   `resolveKbDir()` selects. The caller is responsible for making sure that is
 *   the real store — see the CLI guard.
 */
export function deriveKbSummary(objects = loadKb()) {
  const containers = sourceContainers(objects);

  // Global counters. These are the /knowledge lens's own derivations, read off
  // src/pages/knowledge.astro rather than reinvented — `all.length`,
  // `all.filter(maturity === "raw").length`, `publishableKb(all).length`, and a
  // per-schema tally over `facets(all).schemas`. If that page changes what it
  // counts, this must change with it or the two surfaces disagree.
  const { schemas } = facets(objects);
  const by_schema = Object.fromEntries(
    schemas.map((s) => [s, objects.filter((o) => o.schema === s).length]),
  );

  const summary = {
    _comment: GENERATED_COMMENT,
    objects_total: objects.length,
    in_review: objects.filter((o) => o.maturity === "raw").length,
    published: publishableKb(objects).length,
    by_schema,
    // Order preserved from sourceContainers(): most-populated first,
    // id-ascending on ties, `unattributed` last. The pages render in array
    // order, so preserving it is what makes the clone's /sources identical.
    containers: containers.map((c) => ({
      id: c.id,
      title: c.title,
      card: flattenCard(c.card),
      objects_total: c.objects.length,
      by_schema: c.by_schema,
      by_maturity: c.by_maturity,
      high_risk_count: c.high_risk_count,
      // The number the archive verdict blocks on. Carried explicitly because a
      // summary container has `objects: []`, and archive-ready.mjs fails closed
      // rather than re-deriving 0 from an empty list. See archive-ready.mjs
      // check (3).
      unresolved_high_risk: c.unresolved_high_risk,
    })),
  };

  // Shape assertions. Cheap, and they turn a future silent omission — a renamed
  // field, a container losing its count — into a failed derivation.
  const top = Object.keys(summary).sort().join(",");
  const TOP_KEYS = [
    "_comment",
    "objects_total",
    "in_review",
    "published",
    "by_schema",
    "containers",
  ];
  if (top !== [...TOP_KEYS].sort().join(",")) {
    throw new Error(
      `derive-kb-summary: top-level keys [${top}] — expected exactly [${[...TOP_KEYS].sort()}]. ` +
        "Adding a key here is adding a published field; do it deliberately.",
    );
  }
  for (const c of summary.containers) {
    assertFlatCard(c.id, c.card);
    const keys = Object.keys(c).sort();
    if (keys.join(",") !== [...CONTAINER_KEYS].sort().join(",")) {
      throw new Error(
        `derive-kb-summary: container "${c.id}" has keys [${keys}], expected [${[...CONTAINER_KEYS].sort()}]`,
      );
    }
    for (const n of [
      "objects_total",
      "high_risk_count",
      "unresolved_high_risk",
    ]) {
      if (!Number.isInteger(c[n]) || c[n] < 0) {
        throw new Error(
          `derive-kb-summary: container "${c.id}".${n} must be a non-negative integer, got ${JSON.stringify(c[n])}`,
        );
      }
    }
    if (c.unresolved_high_risk > c.high_risk_count) {
      throw new Error(
        `derive-kb-summary: container "${c.id}" reports ${c.unresolved_high_risk} unresolved ` +
          `high-risk objects out of ${c.high_risk_count} high-risk — the subset cannot exceed the set.`,
      );
    }
    const tally = Object.values(c.by_schema).reduce((a, b) => a + b, 0);
    if (tally !== c.objects_total) {
      throw new Error(
        `derive-kb-summary: container "${c.id}" by_schema sums to ${tally} but objects_total is ${c.objects_total}`,
      );
    }
  }
  // The cards are `source-system` entries in the store, so they are NOT counted
  // inside any container — objects_total across containers is the global total
  // minus the cards. Asserting it here is what makes "Sources 6 · Objects 416"
  // on a clone the same statement as the local build's, rather than a number
  // that happens to render.
  const cardCount = objects.filter((o) => o.schema === "source-system").length;
  const contained = summary.containers.reduce((n, c) => n + c.objects_total, 0);
  if (contained + cardCount !== summary.objects_total) {
    throw new Error(
      `derive-kb-summary: ${contained} objects in containers + ${cardCount} cards ` +
        `!= ${summary.objects_total} objects in the store — some object is in no container ` +
        "and not a card, which the `unattributed` canary should have caught.",
    );
  }

  assertNoObjectLeak(JSON.stringify(summary), objects);
  return summary;
}

// ── CLI ──────────────────────────────────────────────────────────────────
// Compare REALPATHS, not URLs — see the identical note in derive-disposition.mjs.
// Node reports `import.meta.url` symlink-resolved while `process.argv[1]` is the
// path as typed, so a plain compare says "not the entry point" whenever a path
// segment is a symlink (macOS /tmp -> /private/tmp). That failure is silent: the
// script exits 0 having written nothing, and the stale JSON survives.
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return resolve(entry) === self;
  }
}

if (invokedDirectly()) {
  // REFUSE to derive from the fallback. If we are reading data/kb-public/ then
  // there is no workspace store here, and every count would come out 0 — which
  // would overwrite good committed data with zeros and make /sources render as
  // if nothing had ever been ingested. Unlike derive-disposition (which exits 0
  // and leaves its artifact alone), this one is loud: derive-disposition is run
  // opportunistically, whereas someone typing THIS command is asking for a
  // refresh and needs to know they did not get one.
  const kbDir = resolveKbDir();
  if (kbDir === PUBLIC_KB_DIR) {
    console.error(
      "derive-kb-summary: REFUSING to derive from the committed public store.\n" +
        `  resolveKbDir() returned ${kbDir}, i.e. there is no workspace store at\n` +
        "  <refi-bcn-os>/data/kb/. Deriving here would write zeros over a good\n" +
        "  src/data/kb-summary.json.\n" +
        "  Run this inside a refi-bcn-os checkout, or point KB_DIR at a real store.",
    );
    process.exit(1);
  }

  const objects = loadKb(kbDir);
  const summary = deriveKbSummary(objects);
  writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2) + "\n", "utf8");

  console.log(`derive-kb-summary: read ${kbDir}`);
  for (const c of summary.containers) {
    console.log(
      `  ${c.id}: ${c.objects_total} objects · ${c.high_risk_count} high-risk ` +
        `(${c.unresolved_high_risk} unresolved)`,
    );
  }
  console.log(
    `derive-kb-summary: ${summary.objects_total} objects · ${summary.in_review} in review · ` +
      `${summary.published} published · ${summary.containers.length} containers ` +
      "→ src/data/kb-summary.json (all shape + no-leak checks passed).",
  );
}
