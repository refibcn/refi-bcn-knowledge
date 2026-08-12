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

// Mirrors what sourceContainers() produces, INCLUDING `unresolved_high_risk` —
// which archiveReady reads directly rather than deriving from `objects`. The
// default is 0 (nothing unreviewed) so the happy path stays reachable; the
// "count is absent" case is built explicitly, below, because that is a distinct
// state from "the count is zero".
const container = (over = {}) => ({
  id: "src",
  card: { container_role: "source", ...(over.card ?? {}) },
  objects: over.objects ?? [],
  high_risk_count: over.high_risk_count ?? 0,
  unresolved_high_risk: over.unresolved_high_risk ?? 0,
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

// ── The high-risk count: supplied, and fail-closed when it is not ─────────
//
// Three cases, and the third is the whole point. archiveReady used to derive
// this number from `container.objects`; a container built from the committed
// summary carries `objects: []`, so the derivation returned 0 and the check
// passed on NO information. These three tests pin the count as an input and pin
// "absent" to FAIL — the direction that keeps a repo from being frozen on a
// verdict computed without the facts.

test("unreviewed high-risk objects block (count > 0)", () => {
  const v = archiveReady(
    container({
      card: { signoff: { date: "2026-08-11", by: "team" } },
      objects: [
        { high_risk: true, maturity: "raw" },
        { high_risk: true, maturity: "reviewed" },
        { high_risk: false, maturity: "raw" },
      ],
      high_risk_count: 2,
      unresolved_high_risk: 1,
    }),
    deps(clean),
  );
  assert.equal(v.ready, false);
  assert.equal(check(v, "high-risk").pass, false);
  assert.match(
    check(v, "high-risk").detail,
    /1 high-risk objects still at maturity "raw"/,
  );
});

test("reviewed high-risk objects do not block (count === 0)", () => {
  const v = archiveReady(
    container({
      card: { signoff: { date: "2026-08-11", by: "team" } },
      objects: [{ high_risk: true, maturity: "reviewed" }],
      high_risk_count: 1,
      unresolved_high_risk: 0,
    }),
    deps(clean),
  );
  assert.equal(check(v, "high-risk").pass, true);
  assert.equal(
    check(v, "high-risk").detail,
    "1 high-risk objects, all past raw review.",
  );
  assert.equal(v.ready, true);
});

test("an ABSENT high-risk count blocks — never passes on no information", () => {
  // The summary-path shape with the count omitted: objects is empty, so any
  // derivation from it would read 0 and certify. Everything else here is clean
  // and signed off, so this test fails loudly the moment the check goes back to
  // deriving the number instead of demanding it.
  const v = archiveReady(
    {
      id: "refi-bcn-old-kb",
      card: {
        container_role: "source",
        signoff: { date: "2026-08-11", by: "team" },
      },
      objects: [],
      high_risk_count: 157,
      // unresolved_high_risk deliberately absent
    },
    deps(clean),
  );
  assert.equal(check(v, "high-risk").pass, false);
  assert.match(check(v, "high-risk").detail, /unavailable — cannot certify/);
  assert.equal(v.ready, false);
  assert.notEqual(v.status, "archive-ready");
});

test("a non-numeric high-risk count is 'unknown', not 'zero'", () => {
  for (const bad of [null, "0", NaN, undefined]) {
    const v = archiveReady(
      {
        id: "src",
        card: {
          container_role: "source",
          signoff: { date: "2026-08-11", by: "team" },
        },
        objects: [],
        unresolved_high_risk: bad,
      },
      deps(clean),
    );
    assert.equal(
      check(v, "high-risk").pass,
      false,
      `${JSON.stringify(bad)} must not certify`,
    );
  }
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
  // Through the real view model, so this exercises the same normalization the
  // pages use rather than a hand-built fixture. The store lives in this repo,
  // so this runs everywhere — no clone guard.
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

// ── The chip has to say what is true ─────────────────────────────────────
//
// "ingesting" is a present participle: it claims work is underway. Once every
// file in the batch is placed, nothing is being ingested — the container is
// merely not archive-ready, because what remains is human (sign-off, high-risk
// review). Those are different states and the chip must not conflate them.

test("a fully dispositioned batch reads 'absorbed', not 'ingesting'", () => {
  const v = archiveReady(
    { ...container(), id: "refi-bcn-old-kb" }, // no signoff → not archive-ready
    deps({
      ...clean,
      files_total: 272,
      ingested: 88,
      merged: 9,
      excluded: 175,
      pending: 0,
    }),
  );
  assert.equal(v.ready, false); // sign-off still missing
  assert.equal(v.status, "absorbed"); // but the files are all placed
});

test("a batch with files still pending stays 'ingesting'", () => {
  const v = archiveReady(
    container(),
    deps({
      ...clean,
      files_total: 100,
      ingested: 40,
      merged: 0,
      excluded: 0,
      pending: 60,
    }),
  );
  assert.equal(v.status, "ingesting");
});

test("an applicable disposition over zero files is not vacuously 'absorbed'", () => {
  // pending === 0 is trivially true when there is nothing to place. Reading that
  // as "absorbed" would be the same class of error as a test that passes because
  // it asserts nothing.
  const v = archiveReady(
    container(),
    deps({
      ...clean,
      files_total: 0,
      ingested: 0,
      merged: 0,
      excluded: 0,
      pending: 0,
    }),
  );
  assert.equal(v.status, "active");
});

test("an unreconciled batch is not 'absorbed', however zero its pending count", () => {
  // The 2026-08-09 shape again, now aimed at the chip rather than the checklist.
  // `pending` is derived from the batch's own numbers, so it reads 0 while the
  // tree holds files the batch never saw. "Absorbed" asserts every file is
  // placed; over an unreconciled corpus that is an over-claim, and it is the
  // signal that precedes archiving a repo read-only.
  const v = archiveReady(
    container(),
    deps({
      ...clean,
      files_total: 272,
      ingested: 88,
      merged: 9,
      excluded: 172,
      pending: 0,
      discrepancies: [
        "buckets do not sum: 269 dispositioned + 0 pending vs 272 files",
      ],
    }),
  );
  assert.notEqual(v.status, "absorbed");
  assert.equal(v.status, "ingesting"); // what it actually falls back to
  assert.equal(v.ready, false);
});

test("real store: the refi-bcn-old-kb chip the page renders reads 'absorbed'", async () => {
  // sourcesViewModel is what /sources renders from, so this is the assertion
  // that actually pins the user-visible chip rather than a fixture's echo.
  const { sourcesViewModel } = await import("../src/lib/sources.mjs");
  const row = sourcesViewModel().rows.find((r) => r.id === "refi-bcn-old-kb");
  assert.ok(row, "refi-bcn-old-kb should be in the sources view model");
  assert.equal(row.verdict.status, "absorbed");
  assert.equal(row.verdict.ready, false, "still blocked on the human checks");
});
