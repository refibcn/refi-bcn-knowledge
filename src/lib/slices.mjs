// Crosscut computations for /slices — domain × schema matrix, the review
// funnel, the high-risk queue, and public-use-boundary tiers.
//
// Every function here is pure over data the CALLER supplies (objects, or the
// rows a viewmodel already produced) — no file I/O, no `loadKb`, no summary
// reads. That is deliberate, not an oversight: the site builds on two paths
// (a live workspace store with 422 objects, and a standalone CI clone with
// only a committed aggregate summary), and keeping these functions pure over
// caller-supplied data is what lets ONE implementation serve both — the page
// that renders `/slices` decides which source feeds it, this module just
// computes. If a future edit here wants to import `loadKb` or read a JSON
// file, that is a sign the code belongs in the page, not in this module.
//
// `highRiskQueue`'s throw-on-absent follows the doctrine already stated in
// kb-summary.mjs / archive-ready.mjs: a missing `unresolved_high_risk` is a
// statement about the BUILD ("I cannot tell"), and defaulting it to 0 would
// silently restate that as a claim about the CORPUS ("nothing left to
// review"). That conflation is what nearly authorised freezing a repo that
// still held 104 unreviewed high-risk objects (Indigenous/TEK, personal and
// governance-sensitive material) — see archive-ready.mjs lines ~160-197.
import { sortedCounts } from "./kb.mjs";

/**
 * Domain × schema counts. `source-system` cards are infrastructure (they
 * describe a container, not a corpus member) and are excluded, matching the
 * same exclusion `collectionMembers` and `sourceContainers` already apply.
 * A blank/absent `domain` groups under `"unset"` rather than vanishing from
 * every row total silently.
 *
 * @param {{schema: string, domain?: string}[]} objects
 * @returns {{
 *   domains: string[],
 *   schemas: string[],
 *   cell: (domain: string, schema: string) => number,
 *   rowTotal: (domain: string) => number,
 * }}
 */
export function domainMatrix(objects) {
  /** @type {Map<string, Map<string, number>>} */
  const table = new Map();
  const schemaSet = new Set();

  for (const o of objects) {
    if (o?.schema === "source-system") continue; // cards, not corpus members
    const domain = o?.domain || "unset";
    const schema = o?.schema || "unset";
    schemaSet.add(schema);
    if (!table.has(domain)) table.set(domain, new Map());
    const row = table.get(domain);
    row.set(schema, (row.get(schema) ?? 0) + 1);
  }

  const domains = [...table.keys()].sort();
  const schemas = [...schemaSet].sort();

  return {
    domains,
    schemas,
    cell: (domain, schema) => table.get(domain)?.get(schema) ?? 0,
    rowTotal: (domain) => {
      const row = table.get(domain);
      if (!row) return 0;
      let total = 0;
      for (const n of row.values()) total += n;
      return total;
    },
  };
}

/**
 * Per-container raw/reviewed/published counts, read from each row's
 * `by_maturity` rollup (the same shape `sourceContainers` / the committed
 * summary already produce on both the workspace and CI paths).
 *
 * Deliberately reports only these three stages, with `total` taken from
 * `objects_total` rather than summed from the three — on real data the store
 * also carries a `boundary` maturity bucket (public-use-boundary objects),
 * so raw + reviewed + published will NOT equal total. That gap is intended:
 * the /slices page surfaces it as its own labelled line rather than this
 * function inventing a fourth bucket to absorb it.
 *
 * @param {{id: string, title: string, by_maturity?: Record<string, number>, objects_total: number}[]} rows
 * @returns {{id: string, title: string, raw: number, reviewed: number, published: number, total: number}[]}
 */
export function maturityFunnel(rows) {
  return rows.map((r) => {
    const by = r.by_maturity ?? {};
    return {
      id: r.id,
      title: r.title,
      raw: by.raw ?? 0,
      reviewed: by.reviewed ?? 0,
      published: by.published ?? 0,
      total: r.objects_total,
    };
  });
}

/**
 * Per-container high-risk queue: total, unresolved (still at maturity
 * "raw"), and resolved — derived as `total - unresolved`, floored at 0 so a
 * malformed rollup (unresolved > total) cannot report a negative count.
 *
 * Throws when `unresolved_high_risk` is absent rather than defaulting to 0 —
 * see the module header. This mirrors `archiveReady()`'s high-risk check
 * exactly: a missing count fails closed, it never reads as "all clear".
 *
 * @param {{id: string, title: string, high_risk_count: number, unresolved_high_risk?: number}[]} rows
 * @returns {{id: string, title: string, total: number, unresolved: number, resolved: number}[]}
 */
export function highRiskQueue(rows) {
  return rows.map((r) => {
    if (r.unresolved_high_risk === undefined) {
      throw new Error(
        `slices.mjs: highRiskQueue — "${r.id}" carries no unresolved_high_risk count. ` +
          "An absent count is a statement about the build, not a claim that " +
          "nothing is unresolved — it must fail rather than default to 0.",
      );
    }
    const total = r.high_risk_count;
    const unresolved = r.unresolved_high_risk;
    return {
      id: r.id,
      title: r.title,
      total,
      unresolved,
      resolved: Math.max(0, total - unresolved),
    };
  });
}

/**
 * Tally of `public-use-boundary` objects by `raw.tier`. Every other schema is
 * ignored — boundary tiers are a property of boundary records, not of the
 * objects they govern. Reuses kb.mjs's `sortedCounts` for the same reason
 * `finishContainer` does: a key-sorted plain object stays byte-stable across
 * runs instead of following Map insertion order.
 *
 * @param {{schema: string, raw?: Record<string, any>}[]} objects
 * @returns {Record<string, number>}
 */
export function boundaryTiers(objects) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const o of objects) {
    if (o?.schema !== "public-use-boundary") continue;
    const tier = o?.raw?.tier ?? "unset";
    counts.set(tier, (counts.get(tier) ?? 0) + 1);
  }
  return sortedCounts(counts);
}
