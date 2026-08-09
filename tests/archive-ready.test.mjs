// DC-4: archive-ready is COMPUTED. These tests exist mostly to pin the
// fail-closed direction — every missing input must read "not ready", because the
// consequence of a false positive is freezing a repo whose material was never
// dispositioned, and the consequence of a false negative is a re-run.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  archiveReady,
  archiveReadyAll,
  signoff,
  STATUSES,
} from "../src/lib/archive-ready.mjs";

const container = (over = {}) => ({
  id: "src",
  card: { container_role: "source", ...(over.card ?? {}) },
  objects: over.objects ?? [],
  high_risk_count: over.high_risk_count ?? 0,
});

const clean = {
  applicable: true,
  files_total: 10,
  ingested: 6,
  excluded: 3,
  merged: 1,
  pending: 0,
  unaccounted: 0,
  discrepancies: [],
};

const deps = (d) => ({ dispositionFor: () => d });
const check = (v, id) => v.checks.find((c) => c.id === id);

// ── The happy path has to be reachable, or the gate is theatre ────────────

test("a fully dispositioned, signed-off source is archive-ready", () => {
  const v = archiveReady(
    container({ card: { signoff: { date: "2026-08-11", by: "team" } } }),
    deps(clean),
  );
  assert.equal(v.ready, true);
  assert.equal(v.status, "archive-ready");
  assert.deepEqual(v.blockers, []);
});

// ── Fail-closed on every missing input ────────────────────────────────────

test("no sign-off blocks, however clean the numbers", () => {
  const v = archiveReady(container(), deps(clean));
  assert.equal(v.ready, false);
  assert.equal(check(v, "signoff").pass, false);
  assert.match(check(v, "signoff").detail, /never defaulted/i);
});

test("a missing disposition record blocks and names the fix", () => {
  const v = archiveReady(
    container({ card: { signoff: { date: "2026-08-11", by: "team" } } }),
    deps(null),
  );
  assert.equal(v.ready, false);
  assert.match(check(v, "disposition").detail, /derive:disposition/);
});

test("pending files block and the count is in the message", () => {
  const v = archiveReady(
    container({ card: { signoff: { date: "2026-08-11", by: "team" } } }),
    deps({
      ...clean,
      pending: 12,
      ingested: 0,
      excluded: 0,
      merged: 0,
      files_total: 12,
    }),
  );
  assert.equal(v.ready, false);
  assert.match(check(v, "disposition").detail, /12 of 12 files pending/);
});

test("an unexplained corpus gap blocks even when pending reads zero", () => {
  // The precise shape of the 2026-08-09 finding: batch-1 reported its corpus as
  // fully handled while the checkout held 3 more files. `pending` derived from
  // the batch's own numbers can be 0 while the tree disagrees, so reconciliation
  // is a SEPARATE check.
  const v = archiveReady(
    container({ card: { signoff: { date: "2026-08-11", by: "team" } } }),
    deps({
      ...clean,
      pending: 0,
      discrepancies: [
        "corpus: 272 .md on disk vs 269 dispositioned by batch-1",
      ],
    }),
  );
  assert.equal(v.ready, false);
  assert.equal(check(v, "reconciled").pass, false);
  assert.match(check(v, "reconciled").detail, /272 .md on disk/);
});

test("unreviewed high-risk objects block", () => {
  const v = archiveReady(
    container({
      card: { signoff: { date: "2026-08-11", by: "team" } },
      objects: [
        { high_risk: true, maturity: "raw" },
        { high_risk: true, maturity: "reviewed" },
        { high_risk: false, maturity: "raw" },
      ],
      high_risk_count: 2,
    }),
    deps(clean),
  );
  assert.equal(v.ready, false);
  assert.match(
    check(v, "high-risk").detail,
    /1 high-risk objects still at maturity "raw"/,
  );
});

test("reviewed high-risk objects do not block", () => {
  const v = archiveReady(
    container({
      card: { signoff: { date: "2026-08-11", by: "team" } },
      objects: [{ high_risk: true, maturity: "reviewed" }],
      high_risk_count: 1,
    }),
    deps(clean),
  );
  assert.equal(check(v, "high-risk").pass, true);
  assert.equal(v.ready, true);
});

// ── signoff() parsing: partial is not signed ──────────────────────────────

test("signoff needs both date and by; anything less is unsigned", () => {
  assert.equal(signoff(null), null);
  assert.equal(signoff({}), null);
  assert.equal(
    signoff({ signoff: true }),
    null,
    "a bare truthy flag is not a signature",
  );
  assert.equal(signoff({ signoff: { date: "2026-08-11" } }), null);
  assert.equal(signoff({ signoff: { by: "team" } }), null);
  assert.equal(signoff({ signoff: { date: "  ", by: "team" } }), null);
  assert.deepEqual(signoff({ signoff: { date: "2026-08-11", by: "team" } }), {
    date: "2026-08-11",
    by: "team",
  });
});

// ── Not every container is an archive candidate ───────────────────────────

test("a render target is not-applicable rather than not-ready", () => {
  const v = archiveReady(
    {
      id: "refibcn-site",
      card: { container_role: "render-target" },
      objects: [],
    },
    deps(null),
  );
  assert.equal(v.applicable, false);
  assert.equal(v.ready, false);
  assert.match(v.note, /not an ingest source/i);
  assert.deepEqual(v.checks, [], "no checklist should be rendered for it");
});

test("the operating repo itself is not an archive candidate", () => {
  const v = archiveReady(
    { id: "refi-bcn", card: { container_role: "self" }, objects: [] },
    deps(null),
  );
  assert.equal(v.applicable, false);
  assert.match(v.note, /operating repo/i);
});

test("an already-archived source reports archived without re-running checks", () => {
  const v = archiveReady(
    container({ card: { archived_at: "2026-09-01" } }),
    deps(null),
  );
  assert.equal(v.status, "archived");
  assert.equal(v.ready, true);
  assert.match(v.note, /2026-09-01/);
});

test("a container with no card at all is treated as a source and blocks", () => {
  const v = archiveReady(
    { id: "unattributed", card: null, objects: [] },
    deps(null),
  );
  assert.equal(v.applicable, true);
  assert.equal(v.ready, false);
});

// ── Shape ────────────────────────────────────────────────────────────────

test("every status is one the index knows how to render", () => {
  const cases = [
    archiveReady(container(), deps(clean)),
    archiveReady(
      container({ card: { signoff: { date: "d", by: "b" } } }),
      deps(clean),
    ),
    archiveReady(
      container({ card: { container_role: "render-target" } }),
      deps(null),
    ),
    archiveReady(
      container({ card: { archived_at: "2026-09-01" } }),
      deps(null),
    ),
  ];
  for (const v of cases)
    assert.ok(STATUSES.includes(v.status), `unknown status ${v.status}`);
});

test("archiveReadyAll keys verdicts by container id", () => {
  const all = archiveReadyAll(
    [
      container({ card: { container_role: "source" } }),
      { id: "b", card: null, objects: [] },
    ],
    deps(clean),
  );
  assert.deepEqual(Object.keys(all).sort(), ["b", "src"]);
});

// ── Against the real store ───────────────────────────────────────────────

test("real store: refi-bcn-old-kb blocks on high-risk review and sign-off", async () => {
  const { resolveKbDir, PUBLIC_KB_DIR } = await import("../src/lib/kb.mjs");
  if (resolveKbDir() === PUBLIC_KB_DIR) return; // standalone CI clone

  // Through the real view model, so this exercises the same normalization the
  // pages use rather than a hand-built fixture.
  const { sourcesViewModel } = await import("../src/lib/sources.mjs");
  const row = sourcesViewModel().rows.find((r) => r.id === "refi-bcn-old-kb");
  const v = row.verdict;

  // Files and reconciliation now pass (the 2026-08-09 post-hoc dispositions
  // closed the 3-file gap). What legitimately remains is human: of the 157
  // high-risk objects, 104 are still at maturity "raw", and nobody has signed
  // off. Archiving must stay blocked on those, and for those reasons
  // specifically — the assertions below name each check so a future change that
  // trades one blocker for another does not slip through as "still not ready".
  assert.equal(
    check(v, "disposition").pass,
    true,
    check(v, "disposition").detail,
  );
  assert.equal(
    check(v, "reconciled").pass,
    true,
    check(v, "reconciled").detail,
  );
  assert.equal(check(v, "signoff").pass, false, "no sign-off exists yet");
  assert.equal(v.ready, false);
});
