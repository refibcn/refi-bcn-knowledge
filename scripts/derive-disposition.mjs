// Derives the per-source ingest DISPOSITION from the workspace batch rosters
// (refi-bcn-os/docs/kms/batches/*.yaml) into src/data/sources-disposition.json.
//
// Why a committed artifact: the rosters live OUTSIDE this repo, in the
// refi-bcn-os workspace. CI clones this repo standalone, so /sources has to
// render from something committed — same reasoning as data/kb-public/.
//
// Why it asserts instead of trusting: a container's disposition feeds the
// archive-ready verdict, which is the evidence that authorises archiving a
// superseded upstream repo read-only. A silently wrong "0 pending" would
// authorise deleting-by-archiving work that was never ingested. So every count
// is cross-checked against the roster's own arrays, and any mismatch throws.
//
// This script is never bundled (plain Node only), so `import.meta.url` is safe
// here — unlike src/lib/kb.mjs, which Vite emits into dist/. See the path
// resolution note at the top of src/lib/kb.mjs before copying this pattern.
// fileURLToPath, not .pathname — the checkout path contains spaces.
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The workspace batch rosters. Absent in a standalone clone. */
export const BATCH_DIR = resolve(
  REPO_ROOT,
  "..",
  "..",
  "docs",
  "kms",
  "batches",
);

/** The committed output that src/lib/kb.mjs `disposition()` reads. */
export const OUT_FILE = resolve(
  REPO_ROOT,
  "src",
  "data",
  "sources-disposition.json",
);

const nonNegInt = (value, name, label) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${label}: coverage.${name} must be a non-negative integer, got ${JSON.stringify(value)}`,
    );
  }
  return value;
};

const len = (value, name, label) => {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: ${name} must be a list, got ${typeof value}`);
  }
  return value.length;
};

/**
 * One batch roster → one disposition record. Pure; throws on any accounting
 * that does not close.
 *
 * Counts FILES, never work orders: batch-1 prepared 93 work orders from 88
 * source files because several files produced more than one. `ingested` is 88.
 *
 * @param {Record<string, any>} doc  A parsed docs/kms/batches/*.yaml
 * @returns {{ batch: string, source_card: string, status: string,
 *   files_total: number, ingested: number, merged: number, excluded: number,
 *   pending: number, work_orders_prepared: number,
 *   excluded_reasons: { reason: string, files: number, file?: string }[] }}
 */
export function deriveDisposition(doc) {
  const label = String(doc?.batch ?? doc?.source_card ?? "(unnamed batch)");
  const cov = doc?.coverage ?? {};

  const fromContent = nonNegInt(
    cov.includes_from_content,
    "includes_from_content",
    label,
  );
  const fromArchive = nonNegInt(
    cov.includes_from_archive,
    "includes_from_archive",
    label,
  );
  const ingested = fromContent + fromArchive;
  const declaredSources = nonNegInt(
    cov.total_work_order_sources,
    "total_work_order_sources",
    label,
  );
  if (ingested !== declaredSources) {
    throw new Error(
      `${label}: includes_from_content (${fromContent}) + includes_from_archive (${fromArchive}) ` +
        `= ${ingested}, but coverage.total_work_order_sources says ${declaredSources}`,
    );
  }

  const merged = len(doc.merges, "merges", label);
  const declaredMerges = nonNegInt(cov.merges, "merges", label);
  if (merged !== declaredMerges) {
    throw new Error(
      `${label}: the merges list has ${merged} entries, but coverage.merges says ${declaredMerges}`,
    );
  }

  const stubs = len(doc.excluded_stubs, "excluded_stubs", label);
  const declaredStubs = nonNegInt(
    cov.excluded_content_nonstub_stub,
    "excluded_content_nonstub_stub",
    label,
  );
  if (stubs !== declaredStubs) {
    throw new Error(
      `${label}: the excluded_stubs list has ${stubs} entries, but ` +
        `coverage.excluded_content_nonstub_stub says ${declaredStubs}`,
    );
  }

  const workOrders = len(doc.work_orders, "work_orders", label);
  const declaredWorkOrders = nonNegInt(
    cov.work_orders_prepared,
    "work_orders_prepared",
    label,
  );
  if (workOrders !== declaredWorkOrders) {
    throw new Error(
      `${label}: the work_orders list has ${workOrders} entries, but ` +
        `coverage.work_orders_prepared says ${declaredWorkOrders}`,
    );
  }

  const bulk = cov.bulk_excluded ?? {};
  if (typeof bulk !== "object" || bulk === null || Array.isArray(bulk)) {
    throw new Error(
      `${label}: coverage.bulk_excluded must be a reason → count map`,
    );
  }
  const bulkEntries = Object.entries(bulk).map(([reason, files]) => ({
    reason,
    files: nonNegInt(files, `bulk_excluded[${JSON.stringify(reason)}]`, label),
  }));
  const bulkTotal = bulkEntries.reduce((a, e) => a + e.files, 0);

  // Content-side cross-check. Everything decided about content/ — ingested,
  // merged, stubbed — has to fit inside the content tree, and whatever is left
  // over has to be covered by the bulk exclusions. This is the check that
  // catches an inflated `ingested` (the number that authorises archiving).
  const contentTotal = nonNegInt(cov.content_md, "content_md", label);
  const contentDecided = fromContent + merged + stubs;
  if (contentDecided > contentTotal) {
    throw new Error(
      `${label}: ${contentDecided} content files accounted for (${fromContent} ingested + ` +
        `${merged} merged + ${stubs} stubs) exceeds coverage.content_md (${contentTotal})`,
    );
  }
  if (contentTotal - contentDecided > bulkTotal) {
    throw new Error(
      `${label}: ${contentTotal - contentDecided} content files are unaccounted for and ` +
        `bulk_excluded only covers ${bulkTotal}`,
    );
  }

  // Post-hoc dispositions: files the original triage never noticed, appended to
  // the roster rather than folded into `coverage` (which is preserved as the
  // historical record of what the triage actually saw). They are part of the
  // corpus, so they must be part of the totals — batch-1's coverage sums to 269
  // while the checkout holds 272 tracked .md, and the 3-file gap is exactly
  // this block. Dropping it would report a complete disposition for a corpus
  // that is not fully accounted for.
  const postHoc = doc.post_hoc_dispositions ?? {};
  if (typeof postHoc !== "object" || postHoc === null) {
    throw new Error(`${label}: post_hoc_dispositions must be a mapping`);
  }
  const postHocExcluded = postHoc.excluded ?? [];
  if (!Array.isArray(postHocExcluded)) {
    throw new Error(`${label}: post_hoc_dispositions.excluded must be a list`);
  }
  // Refuse to silently ignore a disposition class we do not know how to count.
  // A future `post_hoc_dispositions.ingested:` would otherwise vanish from the
  // ingested total while still looking like a clean derivation.
  const KNOWN_POST_HOC = new Set(["recorded", "reason", "excluded"]);
  const unknown = Object.keys(postHoc).filter((k) => !KNOWN_POST_HOC.has(k));
  if (unknown.length) {
    throw new Error(
      `${label}: unhandled post_hoc_dispositions key(s) ${unknown.join(", ")} — ` +
        "teach derive-disposition.mjs how to count them before they can be trusted",
    );
  }
  const postHocEntries = postHocExcluded.map((e, i) => {
    const file = e?.file;
    if (typeof file !== "string" || !file) {
      throw new Error(
        `${label}: post_hoc_dispositions.excluded[${i}] needs a \`file:\``,
      );
    }
    return { reason: `post-hoc (missed by triage): ${file}`, files: 1, file };
  });

  const excluded = stubs + bulkTotal + postHocEntries.length;
  const accounted = ingested + merged + excluded;
  // A roster may declare an independent corpus total; until one does,
  // files_total is the sum of the parts and `pending` is 0 by construction.
  const filesTotal = cov.files_total ?? cov.corpus_md ?? accounted;
  nonNegInt(filesTotal, "files_total", label);
  const pending = filesTotal - accounted;
  if (pending < 0) {
    throw new Error(
      `${label}: ${accounted} files accounted for exceeds the declared corpus total ${filesTotal}`,
    );
  }

  return {
    batch: label,
    source_card: String(doc.source_card),
    status: String(doc.status ?? "unknown"),
    files_total: filesTotal,
    ingested,
    merged,
    excluded,
    pending,
    work_orders_prepared: workOrders,
    excluded_reasons: [
      ...(stubs
        ? [{ reason: "content stubs (non-substantive)", files: stubs }]
        : []),
      ...bulkEntries.sort(
        (a, b) => b.files - a.files || a.reason.localeCompare(b.reason),
      ),
      ...postHocEntries.sort((a, b) => a.file.localeCompare(b.file)),
    ],
  };
}

/**
 * Every batch roster in `dir`, keyed by its `source_card`. Files without a
 * `source_card` + `coverage` pair are not rosters and are skipped.
 * @param {string} dir
 */
export function deriveDispositions(dir = BATCH_DIR) {
  /** @type {Record<string, ReturnType<typeof deriveDisposition>>} */
  const sources = {};
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    const doc = yaml.load(readFileSync(join(dir, file), "utf8"));
    if (!doc?.source_card || !doc?.coverage) continue;
    const record = deriveDisposition(doc);
    const existing = sources[record.source_card];
    if (existing) {
      // Batch 2 for an already-batched card would need summing, not
      // last-write-wins. Refuse rather than quietly report one batch's numbers
      // as the whole container's disposition.
      throw new Error(
        `${file}: source_card "${record.source_card}" already has a disposition from ` +
          `${existing.batch}. Multi-batch containers need an explicit merge rule — add one.`,
      );
    }
    sources[record.source_card] = record;
  }
  return {
    _comment:
      "GENERATED — do not edit by hand. Written by `npm run derive:disposition` " +
      "from refi-bcn-os/docs/kms/batches/*.yaml. Counts FILES, not work orders.",
    sources: Object.fromEntries(
      Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────
// Compare REALPATHS, not URLs. Node reports `import.meta.url` symlink-resolved
// while `process.argv[1]` is the path as typed, so a plain string/URL compare
// says "not the entry point" whenever any path segment is a symlink (macOS
// /tmp -> /private/tmp is the everyday case). That failure mode is silent: the
// script exits 0 having written nothing, and the stale committed JSON survives.
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return resolve(entry) === self; // not resolvable — fall back to a plain compare
  }
}

if (invokedDirectly()) {
  if (!existsSync(BATCH_DIR)) {
    console.log(
      "derive-disposition: no workspace batch rosters at " +
        BATCH_DIR +
        "\n  (standalone clone — leaving the committed src/data/sources-disposition.json untouched).",
    );
    process.exit(0);
  }
  const out = deriveDispositions(BATCH_DIR);
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
  for (const [card, r] of Object.entries(out.sources)) {
    console.log(
      `  ${card} (${r.batch}, ${r.status}): ${r.files_total} files = ` +
        `${r.ingested} ingested + ${r.merged} merged + ${r.excluded} excluded + ${r.pending} pending ` +
        `[${r.work_orders_prepared} work orders]`,
    );
  }
  console.log(
    `derive-disposition: ${Object.keys(out.sources).length} source(s) written to ` +
      "src/data/sources-disposition.json — all accounting checks passed.",
  );
}
