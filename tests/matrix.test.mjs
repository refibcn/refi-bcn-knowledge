// tests/matrix.test.mjs — the matrix is layers × containers; the invariants are
// honesty ones: unknown ids fail loud, un-listed source rows still appear,
// computed beats asserted, absent renders null (the page's "—"), and a
// high-risk count without an unresolved count throws rather than understating.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LAYERS,
  parseMatrixDefs,
  assembleMatrix,
  matrixViewModel,
} from "../src/lib/matrix.mjs";
import { PLANNED_SOURCES } from "../src/lib/sources.mjs";
import { summaryContainers } from "../src/lib/kb-summary.mjs";

const defs = (cols) => ({ as_of: "2026-08-12", columns: cols });
const row = (over = {}) => ({
  id: "r1",
  title: "Row One",
  card: { corpus_path: "repos/One", url: "https://x/one", steward: "S" },
  objects_total: 10,
  by_maturity: { raw: 7 },
  by_schema: {},
  high_risk_count: 0,
  unresolved_high_risk: 0,
  disposition: {
    applicable: true,
    files_total: 20,
    ingested: 5,
    merged: 1,
    excluded: 4,
    pending: 10,
  },
  role: "source",
  href: "sources/r1/",
  ...over,
});

test("LAYERS is the spec's eight rows, in order", () => {
  assert.deepEqual(
    LAYERS.map((l) => l.id),
    [
      "location",
      "origin",
      "ingestion",
      "store",
      "ontology",
      "review",
      "internal",
      "public",
    ],
  );
});

test("parseMatrixDefs: strict — an unknown key on a column throws", () => {
  assert.throws(
    () => parseMatrixDefs(defs([{ id: "r1", label: "X", ontolgy: "typo" }])),
    /ontolgy/,
  );
});

test("assembleMatrix: unknown column id throws rather than inventing a container", () => {
  assert.throws(
    () =>
      assembleMatrix({
        defs: parseMatrixDefs(defs([{ id: "ghost", label: "G" }])),
        rows: [row()],
        planned: [],
      }),
    /ghost/,
  );
});

test("a source-role row missing from defs is appended as a bare computed column", () => {
  const m = assembleMatrix({
    defs: parseMatrixDefs(defs([{ id: "r1", label: "One" }])),
    rows: [row(), row({ id: "r2", title: "Row Two", href: "sources/r2/" })],
    planned: [],
  });
  const ids = m.columns.map((c) => c.id);
  assert.deepEqual(ids, ["r1", "r2"]);
  assert.equal(m.columns[1].cells.ontology, null); // asserted cells absent → null
  assert.equal(m.columns[1].cells.store.text, "10 typed objects"); // computed still live
});

test("computed beats asserted: location from the card, origin from the disposition", () => {
  const m = assembleMatrix({
    defs: parseMatrixDefs(
      defs([{ id: "r1", label: "One", location: "should-not-win" }]),
    ),
    rows: [row()],
    planned: [],
  });
  const c = m.columns[0].cells;
  assert.equal(c.location.text, "repos/One");
  assert.equal(c.location.href, "https://x/one");
  assert.equal(c.origin.text, "20 files");
  assert.match(
    c.ingestion.detail,
    /5 ingested · 1 merged · 4 excluded · 10 pending/,
  );
});

test("origin_note wins when files are the wrong unit (applicable: false)", () => {
  const m = assembleMatrix({
    defs: parseMatrixDefs(
      defs([{ id: "r1", label: "One", origin_note: "~571 records" }]),
    ),
    rows: [
      row({ disposition: { applicable: false, reason: "No file corpus" } }),
    ],
    planned: [],
  });
  assert.equal(m.columns[0].cells.origin.text, "~571 records");
});

test("origin: a real file count beats an origin_note that contradicts it", () => {
  // The other direction of the same rule, and the one no live column exercises:
  // the only carded column with an origin_note (notion-refi-bcn) is
  // `applicable: false`, so without this fixture the origin half of "computed
  // beats asserted" is verified by neither the tests nor the production data.
  const m = assembleMatrix({
    defs: parseMatrixDefs(
      defs([{ id: "r1", label: "One", origin_note: "should-not-win" }]),
    ),
    rows: [row()], // applicable disposition, files_total 20
    planned: [],
  });
  assert.equal(m.columns[0].cells.origin.text, "20 files");
});

test("review cell: raw + unresolved compose; zero raw with no note renders null", () => {
  const m = assembleMatrix({
    defs: parseMatrixDefs(defs([{ id: "r1", label: "One" }])),
    rows: [
      row({
        by_maturity: { raw: 362 },
        high_risk_count: 157,
        unresolved_high_risk: 104,
      }),
    ],
    planned: [],
  });
  assert.equal(
    m.columns[0].cells.review.text,
    "362 raw · 104 high-risk unresolved",
  );
  const m2 = assembleMatrix({
    defs: parseMatrixDefs(defs([{ id: "r1", label: "One" }])),
    rows: [row({ by_maturity: {}, high_risk_count: 0 })],
    planned: [],
  });
  assert.equal(m2.columns[0].cells.review, null);
});

test("high_risk_count > 0 with unresolved_high_risk undefined THROWS (absent ≠ 0)", () => {
  assert.throws(
    () =>
      assembleMatrix({
        defs: parseMatrixDefs(defs([{ id: "r1", label: "One" }])),
        rows: [row({ high_risk_count: 5, unresolved_high_risk: undefined })],
        planned: [],
      }),
    // Matched, not bare: an unmatched assert.throws passes on ANY throw, so a
    // typo elsewhere in the fixture would green this test for the wrong reason.
    /refusing to understate/,
  );
});

test("planned column: asserted cells only, dashed, gate + owner carried, store null", () => {
  const m = assembleMatrix({
    defs: parseMatrixDefs(
      defs([
        {
          id: "p1",
          label: "Planned One",
          location: "External (pending)",
          origin_note: "consent granted",
          ingestion: "export pending",
          gate: "Luiz produces the export",
          owner: "Luiz",
        },
      ]),
    ),
    rows: [],
    planned: [
      {
        id: "p1",
        title: "Planned One",
        planned: true,
        why: "w",
        blocked_on: "b",
      },
    ],
  });
  const c = m.columns[0];
  assert.equal(c.planned, true);
  assert.equal(c.gate, "Luiz produces the export");
  assert.equal(c.owner, "Luiz");
  assert.equal(c.cells.location.text, "External (pending)");
  assert.equal(c.cells.store, null);
});

test("a carded row beats a stale planned entry of the same id", () => {
  // The day catalunya-map or telegram-history gets a card it will briefly be in
  // BOTH lists. Planned-first would pin a real container to "planned" forever —
  // and understate it: no store count, no disposition, no review numbers.
  const m = assembleMatrix({
    defs: parseMatrixDefs(defs([{ id: "r1", label: "One" }])),
    rows: [row()],
    planned: [
      { id: "r1", title: "Row One", planned: true, why: "w", blocked_on: "b" },
    ],
  });
  assert.equal(m.columns.length, 1);
  const c = m.columns[0];
  assert.equal(c.planned, false);
  assert.equal(c.href, "sources/r1/"); // planned columns carry href null
  assert.equal(c.cells.store.text, "10 typed objects"); // computed, not dashed
  assert.equal(c.cells.origin.text, "20 files");
});

test("infra rows (role !== source) land in the footnote, never as columns", () => {
  const m = assembleMatrix({
    defs: parseMatrixDefs(defs([{ id: "r1", label: "One" }])),
    rows: [
      row(),
      row({ id: "self1", role: "self", title: "Self", href: "sources/self1/" }),
    ],
    planned: [],
  });
  assert.deepEqual(
    m.columns.map((c) => c.id),
    ["r1"],
  );
  assert.deepEqual(
    m.footnote.map((f) => f.id),
    ["self1"],
  );
});

test("the unattributed canary is neither a column nor a footnote entry", () => {
  // It is a bucket for objects no container claimed, not a container — it has no
  // card, so it arrives with role "unknown" and would otherwise be listed as
  // infrastructure alongside the self and render-target repos.
  const m = assembleMatrix({
    defs: parseMatrixDefs(defs([{ id: "r1", label: "One" }])),
    rows: [
      row(),
      row({
        id: "unattributed",
        title: "Unattributed",
        role: "unknown",
        card: null,
        objects_total: 0,
        href: "sources/unattributed/",
      }),
    ],
    planned: [],
  });
  assert.deepEqual(
    m.columns.map((c) => c.id),
    ["r1"],
  );
  assert.deepEqual(m.footnote, []);
});

test("the committed matrix.yaml resolves: every id is a summary container or a planned source", () => {
  // summaryContainers() reads the committed aggregate — present on BOTH paths,
  // so this coverage test never skips in a clone.
  const vm = matrixViewModel();
  const known = new Set([
    ...summaryContainers().map((c) => c.id),
    ...PLANNED_SOURCES.map((p) => p.id),
  ]);
  assert.ok(
    vm.columns.length >= 7,
    `expected ≥7 columns, got ${vm.columns.length}`,
  );
  for (const c of vm.columns)
    assert.ok(known.has(c.id), `unknown column ${c.id}`);
  assert.equal(vm.asOf, "2026-08-12");
});
