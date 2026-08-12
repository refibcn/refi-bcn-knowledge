// View-model for the /sources pages. One place that knows how a container is
// presented, so the index, the container pages and the review-lens facet cannot
// drift apart — C2 says "reuse sourceContainers — no second grouping
// implementation", and this is the layer that keeps that honest.
import { loadKb, sourceContainers, disposition } from "./kb.mjs";
import { archiveReady } from "./archive-ready.mjs";

// A card reaches us either as the raw YAML entry or as a KbObject wrapping it in
// `.raw`, depending on whether sourceContainers derived the card list itself.
// Same accessor kb.mjs uses internally.
const cf = (card, name) => card?.[name] ?? card?.raw?.[name];

/**
 * Normalize a disposition entry into the shape the pages and the archive verdict
 * consume.
 *
 * `scripts/derive-disposition.mjs` is the authority on the numbers; this is the
 * only place that adapts them, so the script stays free to record whatever a
 * batch actually says without every consumer learning its schema.
 *
 * Two things it adds:
 *   - `applicable`: false for a source where FILES are the wrong unit (a Notion
 *     workspace, the publish target). Distinct from "0 pending", which would read
 *     as "nothing left to do".
 *   - `discrepancies`: surfaced so the archive verdict can block on a corpus that
 *     does not reconcile even when `pending` reads 0 — the failure mode found on
 *     2026-08-09, where batch-1 accounted for 269 files and the tree held 272.
 *
 * @param {Record<string, any> | null} entry
 * @param {Record<string, any> | null} card
 * @returns {Disposition | null}
 */
export function normalizeDisposition(entry, card) {
  if (!entry) {
    // No roster. If the card names a file corpus we simply have not measured it;
    // if it names none, files are the wrong unit and we say which.
    const corpus = cf(card, "corpus_path");
    const role = cf(card, "container_role") ?? "source";
    if (corpus) return null; // "not measured" — the verdict blocks and names the fix
    return {
      applicable: false,
      reason:
        role === "render-target"
          ? "Publish target, not an ingest source — nothing to disposition."
          : role === "self"
            ? "The operating repo itself; its knowledge-bearing subtree is tracked as refi-bcn-os-operations."
            : `No file corpus (${cf(card, "type") ?? "unknown type"}) — content lives in the system, not in tracked files.`,
    };
  }
  const files_total = Number(entry.files_total ?? 0);
  const ingested = Number(entry.ingested ?? 0);
  const excluded = Number(entry.excluded ?? 0);
  const merged = Number(entry.merged ?? 0);
  const pending = Number(entry.pending ?? 0);
  const dispositioned = ingested + excluded + merged;
  const discrepancies = [...(entry.discrepancies ?? [])];
  // Recomputed here rather than trusted: the whole point of DC-4 is that the
  // verdict does not take a batch's word for its own completeness.
  if (files_total && dispositioned + pending !== files_total) {
    discrepancies.push(
      `buckets do not sum: ${dispositioned} dispositioned + ${pending} pending vs ${files_total} files`,
    );
  }
  return {
    applicable: true,
    files_total,
    ingested,
    excluded,
    merged,
    pending,
    unaccounted: files_total - dispositioned - pending,
    batches: entry.batch
      ? [
          {
            batch: String(entry.batch),
            status: String(entry.status ?? "unknown"),
          },
        ]
      : (entry.batches ?? []),
    discrepancies,
  };
}

/** Which existing views cover a given container, for the "the views over it"
 *  links C2 asks for. Keyed by container id; a container with no entry shows
 *  only the generic knowledge/review links. */
const VIEWS = {
  "refi-bcn-old-kb": [
    { label: "Knowledge", href: "knowledge/", note: "public reviewed pages" },
    {
      label: "Review lens",
      href: "review/",
      note: "internal, password-gated",
      internal: true,
    },
  ],
  "notion-refi-bcn": [
    { label: "Organizations", href: "organizations/", note: "directory" },
    { label: "Programs", href: "programs/", note: "directory" },
    { label: "Events", href: "events/", note: "directory" },
    { label: "Atlas", href: "atlas/", note: "by comarca" },
  ],
};

/**
 * Sources that have no card yet but are already committed to, so the index can
 * show them without inventing store entries. Marked `planned: true` and rendered
 * as such — the alternative is a surface that silently omits known work.
 *
 * `telegram-history` becomes a real card when its batch runs (BD-2026-065); it
 * is consent-gated by task-260721 and must not look further along than it is.
 */
export const PLANNED_SOURCES = Object.freeze([
  {
    id: "catalunya-map",
    title: "Catalunya regeneration map (Giulio)",
    planned: true,
    why: "Second stream of the single consolidated batch (BD-2026-065) — the ~300–400 mapped actors join the CRM and the store.",
    blocked_on:
      "The D9 coordinate-source answer (which also decides pins vs comarca-shading on /atlas). No card exists until the batch runs.",
  },
  {
    id: "telegram-history",
    title: "Telegram history (ReFi BCN group)",
    planned: true,
    why: "Third stream of the single consolidated batch (BD-2026-065).",
    blocked_on:
      "Team consent (task-260721) and Luiz producing the export. No card exists until the batch runs.",
  },
  {
    id: "research-agent",
    title: "Research agent (serverito)",
    planned: true,
    why: "Continuous scouting stream over funding portals and the regenerative web — candidates reviewed before anything reaches the CRM.",
    blocked_on:
      "Write path held (F6) until the C1 data-model call lands; candidates stay on serverito. No card exists until its stream lands in the store.",
  },
]);

/**
 * @typedef {object} SourceView
 * @property {string} label
 * @property {string} href
 * @property {string} note
 * @property {boolean} [internal]
 */

/**
 * @typedef {object} Disposition
 * @property {boolean} applicable
 * @property {string} [reason]
 * @property {number} [files_total]
 * @property {number} [ingested]
 * @property {number} [excluded]
 * @property {number} [merged]
 * @property {number} [pending]
 * @property {number} [unaccounted]
 * @property {{batch: string, status: string}[]} [batches]
 * @property {string[]} [discrepancies]
 */

/**
 * @typedef {object} SourceRow
 * @property {string} id
 * @property {string} title
 * @property {Record<string, any> | null} card
 * @property {any[]} objects
 * @property {number} objects_total  The count every page reads — named, never
 *   `objects.length` off the array (see the SourceContainer typedef in kb.mjs).
 * @property {Record<string, number>} by_maturity
 * @property {Record<string, number>} by_schema
 * @property {number} high_risk_count
 * @property {number} unresolved_high_risk  High-risk objects still at maturity
 *   `raw`. Tallied by sourceContainers and depended on by archive-ready.mjs,
 *   matrix.mjs and the /sources pages — absent, each of them fails closed
 *   rather than reading it as 0, because 0 is a claim about the corpus and
 *   absent is one about the build.
 * @property {Disposition | null} disposition
 * @property {import("./archive-ready.mjs").Verdict} verdict
 * @property {string} role
 * @property {SourceView[]} views
 * @property {string} href
 */

/** Order the index reads best in: real containers, planned rows, then the
 *  unattributed canary — which stays visible at zero on purpose.
 *  @returns {{rows: SourceRow[], planned: typeof PLANNED_SOURCES, totals: {objects: number, containers: number, unattributed: number}}} */
export function sourcesViewModel({ internal = false } = {}) {
  // ONE container source: the in-repo store (kb/), which every build — dev,
  // CI, standalone clone — carries since the 2026-08-12 md-store migration.
  // (The dual path this used to fork on — live store vs a committed aggregate
  // summary — is retired with the parent-workspace store.)
  //
  // One argument: sourceContainers derives the card list from the store's own
  // source-system entries. C2's "no second grouping implementation" rule.
  const containers = sourceContainers(loadKb());

  const rows = containers.map((c) => {
    // Flatten the card ONCE, before anything reads it. A card arrives either as
    // the raw YAML entry or as a KbObject wrapping it in `.raw`; downstream code
    // (and the verdict) reads plain fields like `container_role` and `signoff`,
    // and a card that still needed `.raw` would silently read as absent —
    // which for `signoff` means "unsigned" and for `archived_at` means "live".
    const card = c.card ? { ...(c.card.raw ?? {}), ...c.card } : null;
    const flat = { ...c, card };
    const d = normalizeDisposition(disposition(c.id), card);
    return {
      ...flat,
      disposition: d,
      verdict: archiveReady(flat, { dispositionFor: () => d }),
      role: cf(card, "container_role") ?? (card ? "source" : "unknown"),
      views: (VIEWS[c.id] ?? []).filter((v) => internal || !v.internal),
      href: `sources/${c.id}/`,
    };
  });

  return {
    rows,
    planned: PLANNED_SOURCES,
    // `objects_total`, never `objects.length` — the named-count contract.
    totals: {
      objects: rows.reduce((n, r) => n + r.objects_total, 0),
      containers: rows.filter((r) => r.id !== "unattributed").length,
      unattributed:
        rows.find((r) => r.id === "unattributed")?.objects_total ?? 0,
    },
  };
}

/** Percentages for the disposition bar; returns null when files are the wrong
 *  unit for this source, so the page can say that instead of drawing an empty
 *  bar that reads as "nothing to do".
 *  @param {Disposition | null | undefined} d
 *  @returns {{ingested: number, merged: number, excluded: number, pending: number, files_total: number, label: string} | null} */
export function dispositionBar(d) {
  if (!d?.applicable || !d.files_total) return null;
  const total = d.files_total;
  const pct = (n = 0) => Math.round((n / total) * 1000) / 10;
  return {
    ingested: pct(d.ingested),
    merged: pct(d.merged),
    excluded: pct(d.excluded),
    pending: pct(d.pending),
    files_total: total,
    label: `${total} files: ${d.ingested} ingested, ${d.merged} merged, ${d.excluded} excluded, ${d.pending} pending`,
  };
}
