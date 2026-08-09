// Archive-ready verdicts (close-out plan DC-4).
//
// A repo may be archived only when its container can PROVE it is safe to freeze.
// The plan's wording is the whole design: "Archive-ready is computed." Nothing
// here reads a human's "yes it's done" — it reads counts and a recorded
// signature, and it defaults to NOT ready whenever it cannot tell.
//
// The asymmetry is deliberate. Archiving is the one step in this plan that is
// awkward to undo and that removes the corpus from normal working view, so a
// missing input must read as "not ready", never as "no objection found".
// Concretely: `team_signoff` is true only when a card carries a real
// `signoff: {date, by}`, written at a Phase F gate. An absent card, an absent
// disposition, an unparseable signoff — all block.
// `dispositionFor` is always injected by sourcesViewModel, which normalizes the
// raw roster entry first (see normalizeDisposition in ./sources.mjs). The default
// exists only so a caller can compute a verdict standalone; it deliberately does
// NOT reach for kb.mjs's disposition() directly, because that returns the raw
// roster shape and this module expects the normalized one — importing it here
// would create a quiet shape mismatch AND a cycle with sources.mjs.
const NO_DISPOSITION = () => null;

/** Container statuses the index renders as chips. */
export const STATUSES = Object.freeze([
  "active",
  "ingesting",
  "absorbed",
  "archive-ready",
  "archived",
]);

/**
 * @typedef {object} Check
 * @property {string} id
 * @property {string} label     What must be true, phrased as the goal
 * @property {boolean} pass
 * @property {string} detail    Why it fails, with the number in it — or how it passed
 */

/**
 * @typedef {object} Verdict
 * @property {boolean} ready
 * @property {boolean} applicable  false = archiving is not a question for this source
 * @property {string} status       One of STATUSES
 * @property {Check[]} checks
 * @property {string[]} blockers   `detail` of every failing check, for one-line rendering
 * @property {string} [note]       Set instead of checks when archiving is not a
 *                                 question here (render target, self, archived)
 */

/** Signoff is a recorded signature or it does not exist. Never defaulted true. */
export function signoff(card) {
  const s = card?.signoff;
  if (!s || typeof s !== "object") return null;
  const date = typeof s.date === "string" ? s.date.trim() : "";
  const by = typeof s.by === "string" ? s.by.trim() : "";
  if (!date || !by) return null;
  return { date, by };
}

/**
 * Compute the archive-ready verdict for one source container.
 *
 * @param {{id: string, card: Record<string, any> | null, objects: any[], high_risk_count?: number}} container
 * @param {{dispositionFor?: (id: string) => any}} [deps] Injectable for tests.
 * @returns {Verdict}
 */
export function archiveReady(container, deps = {}) {
  const dispositionFor = deps.dispositionFor ?? NO_DISPOSITION;
  const card = container.card ?? null;
  const role = card?.container_role ?? "source";

  // Already archived: report it, don't re-litigate the checks.
  if (card?.archived_at) {
    return {
      ready: true,
      applicable: true,
      status: "archived",
      checks: [],
      blockers: [],
      note: `Archived ${card.archived_at}.`,
    };
  }

  // Not every container is a repo awaiting archive. Saying "not ready" about the
  // publish target would be a false alarm; saying "ready" would be worse.
  if (role !== "source") {
    return {
      ready: false,
      applicable: false,
      status: role === "render-target" ? "active" : "active",
      checks: [],
      blockers: [],
      note:
        role === "render-target"
          ? "Publish target, not an ingest source — archiving is not a question here."
          : "The operating repo itself — not a candidate for archive.",
    };
  }

  const d = dispositionFor(container.id);
  /** @type {Check[]} */
  const checks = [];

  // 1. Every file dispositioned.
  if (!d) {
    checks.push({
      id: "disposition",
      label:
        "Every file dispositioned (ingested, merged, or excluded with a reason)",
      pass: false,
      detail:
        "No disposition record — run `npm run derive:disposition` in a refi-bcn-os checkout.",
    });
  } else if (!d.applicable) {
    checks.push({
      id: "disposition",
      label:
        "Every file dispositioned (ingested, merged, or excluded with a reason)",
      pass: false,
      detail: d.reason ?? "Disposition does not apply to this source.",
    });
  } else if (d.pending > 0) {
    checks.push({
      id: "disposition",
      label:
        "Every file dispositioned (ingested, merged, or excluded with a reason)",
      pass: false,
      detail: `${d.pending} of ${d.files_total} files pending${
        d.discrepancies?.length ? ` — ${d.discrepancies[0]}` : ""
      }`,
    });
  } else {
    checks.push({
      id: "disposition",
      label:
        "Every file dispositioned (ingested, merged, or excluded with a reason)",
      pass: true,
      detail: `${d.files_total} files: ${d.ingested} ingested · ${d.merged} merged · ${d.excluded} excluded · 0 pending`,
    });
  }

  // 2. No unexplained corpus gap. Separate from (1) because a batch can report
  //    0 pending while its own numbers contradict the tree — that is the exact
  //    failure that made F4's precondition false on 2026-08-09.
  const gaps = d?.discrepancies ?? [];
  checks.push({
    id: "reconciled",
    label: "Batch numbers reconcile against the files on disk",
    pass: gaps.length === 0,
    detail:
      gaps.length === 0
        ? "No unexplained gap between the batch records and the checkout."
        : gaps.join(" · "),
  });

  // 3. High-risk objects resolved. High-risk material (Indigenous/TEK, personal
  //    data, governance) needs a public-use boundary decision before the source
  //    it came from is frozen — afterwards the context is harder to recover.
  const unresolvedHighRisk = container.objects.filter(
    (o) => o.high_risk && o.maturity === "raw",
  ).length;
  checks.push({
    id: "high-risk",
    label: "No high-risk object left unreviewed",
    pass: unresolvedHighRisk === 0,
    detail:
      unresolvedHighRisk === 0
        ? `${container.high_risk_count ?? 0} high-risk objects, all past raw review.`
        : `${unresolvedHighRisk} high-risk objects still at maturity "raw"`,
  });

  // 4. Team sign-off recorded.
  const sig = signoff(card);
  checks.push({
    id: "signoff",
    label: "Team sign-off recorded on the source card",
    pass: Boolean(sig),
    detail: sig
      ? `Signed off ${sig.date} by ${sig.by}.`
      : "No sign-off recorded — written only at a Phase F gate, never defaulted.",
  });

  const ready = checks.every((c) => c.pass);
  const anyIngested = d?.applicable && d.ingested > 0;
  // "ingesting" is a present participle — it claims work is underway. Once every
  // file is placed (ingested, merged, or excluded), nothing is being ingested;
  // the container is *absorbed* but still not archive-ready, because what remains
  // is human: sign-off and high-risk review. The `files_total > 0` guard keeps a
  // disposition that applies to nothing from reading as vacuously complete.
  const fullyDispositioned =
    d?.applicable && d.files_total > 0 && d.pending === 0;
  return {
    ready,
    applicable: true,
    status: ready
      ? "archive-ready"
      : fullyDispositioned
        ? "absorbed"
        : anyIngested
          ? "ingesting"
          : "active",
    checks,
    blockers: checks.filter((c) => !c.pass).map((c) => c.detail),
  };
}

/** Verdicts for a whole container list, keyed by container id. */
export function archiveReadyAll(containers, deps = {}) {
  return Object.fromEntries(
    containers.map((c) => [c.id, archiveReady(c, deps)]),
  );
}
