// The committed aggregate summary of the KMS store — the standalone-clone half
// of the source containers and the /knowledge counters.
//
// The store (refi-bcn-os/data/kb/) lives OUTSIDE this repo. GitHub Actions
// clones this repo standalone, so `resolveKbDir()` falls back to the committed
// public subset at data/kb-public/, which is legitimately EMPTY until human
// review promotes objects. Before this module existed, that fallback rendered
// /sources as "Sources 0 · Objects 0" with no container pages at all, and
// /knowledge as 0 ingested — because the container cards are themselves
// `source-system` entries in the store.
//
// So: aggregates are derived from the workspace by `npm run derive:kb-summary`
// and committed, exactly like src/data/sources-disposition.json. Bodies are NOT
// — the content boundary is unchanged, and `publishableKb()` stays fail-closed.
//
// Path resolution follows the same rule as kb.mjs `disposition()`: anchor on the
// repo root and readFileSync. Do NOT `import` the JSON — Vite would inline it
// into the client bundle, which is exactly the leak the dist gate exists to
// catch.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveKbDir, PUBLIC_KB_DIR } from "./kb.mjs";

// Same walk-up as kb.mjs findRepoRoot(), and for the same reason: this module is
// emitted into dist/ by Vite, so `import.meta.url` is the emitted chunk, not
// this file. See the long note at the top of kb.mjs.
function findRepoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        "kb-summary.mjs: no package.json found above " +
          fileURLToPath(import.meta.url),
      );
    }
    dir = parent;
  }
  return dir;
}

const REPO_ROOT = findRepoRoot();

export const SUMMARY_FILE = resolve(
  REPO_ROOT,
  "src",
  "data",
  "kb-summary.json",
);

/** @type {Map<string, Record<string, any>>} */
const cache = new Map();

/**
 * True when this build has no workspace store and is therefore reading the
 * committed public subset — the one situation where the summary is the better
 * source for aggregates. Note this stays true once `data/kb-public/` is
 * non-empty: at that point the public store holds only the PUBLISHED objects, a
 * strict subset, so container tallies computed from it would understate the
 * corpus rather than describe it.
 */
export function usingCommittedStore() {
  return resolveKbDir() === PUBLIC_KB_DIR;
}

/**
 * The committed summary.
 *
 * A MISSING file throws rather than degrading to zeros — same reasoning as
 * `disposition()` in kb.mjs. Silent zeros here would render /sources as "nothing
 * has been ingested", which is the reading that could authorise archiving a
 * source that was never processed.
 *
 * @param {string} [file]
 */
export function kbSummary(file = SUMMARY_FILE) {
  if (!cache.has(file)) {
    if (!existsSync(file)) {
      throw new Error(
        `kb-summary.mjs: missing ${file}. It is a committed artifact — run ` +
          "`npm run derive:kb-summary` inside a refi-bcn-os checkout.",
      );
    }
    cache.set(file, JSON.parse(readFileSync(file, "utf8")));
  }
  return cache.get(file);
}

/**
 * The summary's containers in `sourceContainers()` shape — IDENTICAL row shape,
 * with `objects: []`. Downstream (sources.astro, sources/[id].astro,
 * dispositionBar, archiveReady) must not need to know which path a row came
 * from, so the difference is confined to this one function.
 *
 * `objects: []` is honest, not a placeholder: the public build renders no object
 * bodies by design (DC-3), and every count a page shows comes from the named
 * aggregate fields rather than from `objects.length`.
 *
 * @param {string} [file]
 * @returns {import("./kb.mjs").SourceContainer[]}
 */
export function summaryContainers(file = SUMMARY_FILE) {
  return kbSummary(file).containers.map((c) => ({
    id: c.id,
    title: c.title,
    card: c.card,
    objects: [],
    by_maturity: c.by_maturity,
    by_schema: c.by_schema,
    high_risk_count: c.high_risk_count,
    unresolved_high_risk: c.unresolved_high_risk,
    /** The count `objects.length` would give if the bodies were here. Named
     *  separately so no consumer can accidentally read 0 off the empty array. */
    objects_total: c.objects_total,
  }));
}
