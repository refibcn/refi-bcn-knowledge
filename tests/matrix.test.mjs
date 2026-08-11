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

// ---------------------------------------------------------------------------
// The href contract. A cell's href is either instance-relative (the page wraps
// it in withBase()) or an absolute card URL (used as-is). Before `external`
// existed, withBase() would have rendered "/https://github.com/refibcn/..." on
// three of the four carded columns.
// ---------------------------------------------------------------------------

test("a card's absolute URL is flagged external", () => {
  const m = assembleMatrix({
    defs: parseMatrixDefs(defs([{ id: "r1", label: "One" }])),
    rows: [row()],
    planned: [],
  });
  const loc = m.columns[0].cells.location;
  assert.equal(loc.href, "https://x/one");
  assert.equal(loc.external, true);
});

test("a relative href is NOT flagged external, and no YAML cell ever is", () => {
  // The negative half: `external` must mean "absolute", not "has an href".
  const m = assembleMatrix({
    defs: parseMatrixDefs(defs([{ id: "r1", label: "One" }])),
    rows: [
      row({ card: { corpus_path: "packages/operations", url: undefined } }),
    ],
    planned: [],
  });
  assert.equal(m.columns[0].cells.location.external, undefined);
  // And over the real file: hand-authored hrefs are relative by schema, so no
  // asserted cell may carry the flag.
  for (const c of matrixViewModel().columns)
    for (const key of ["internal", "public", "ontology"])
      assert.equal(c.cells[key]?.external, undefined, `${c.id}.${key}`);
});

test("an absolute href in the YAML is rejected, not silently marked external", () => {
  assert.throws(
    () =>
      parseMatrixDefs(
        defs([
          {
            id: "r1",
            label: "One",
            public: { text: "Site", href: "https://example.org/" },
          },
        ]),
      ),
    /instance-relative/,
  );
});

// ---------------------------------------------------------------------------
// Schema strictness and operator-legible errors.
// ---------------------------------------------------------------------------

test("the cells object carries exactly the LAYERS ids, in order", () => {
  // The eight keys are written out in cardedColumn and again in plannedColumn;
  // nothing but this ties either to LAYERS. Add a layer and forget one, and the
  // page throws at build time reading an undefined cell.
  const m = assembleMatrix({
    defs: parseMatrixDefs(
      defs([
        { id: "r1", label: "One" },
        { id: "p1", label: "Planned" },
      ]),
    ),
    rows: [row()],
    planned: [{ id: "p1", title: "Planned", planned: true }],
  });
  const layerIds = LAYERS.map((l) => l.id);
  assert.equal(m.columns.length, 2);
  for (const c of m.columns)
    assert.deepEqual(Object.keys(c.cells), layerIds, `column ${c.id}`);
});

test("parseMatrixDefs: a duplicate column id throws, naming it", () => {
  assert.throws(
    () =>
      parseMatrixDefs(
        defs([
          { id: "r1", label: "One" },
          { id: "r1", label: "One again" },
        ]),
      ),
    /duplicate column id "r1"/,
  );
});

test("parseMatrixDefs: an empty defs file names the file, not `: Required`", () => {
  // An empty YAML file parses to undefined; reaching zod it produced an issue
  // with an empty path, i.e. an error naming nothing.
  assert.throws(() => parseMatrixDefs(undefined), /must hold a mapping/);
  assert.throws(() => parseMatrixDefs([]), /must hold a mapping/);
});

test("parseMatrixDefs: errors name the offending column and the file", () => {
  assert.throws(
    () =>
      parseMatrixDefs(
        defs([
          { id: "r1", label: "One" },
          { id: "notion-refi-bcn" }, // no label
        ]),
      ),
    /column "notion-refi-bcn" in .*matrix\.yaml is invalid/,
  );
});

test("CellSchema is strict: a typo'd `hef:` throws instead of dropping the link", () => {
  assert.throws(
    () =>
      parseMatrixDefs(
        defs([
          { id: "r1", label: "One", public: { text: "Knowledge", hef: "k/" } },
        ]),
      ),
    /hef/,
  );
});

test("as_of must be an ISO date — `soon` is not a freshness claim", () => {
  assert.throws(
    () =>
      parseMatrixDefs({ as_of: "soon", columns: [{ id: "r1", label: "L" }] }),
    /ISO date/,
  );
});

test('an empty string is not an assertion: `ingestion: ""` throws', () => {
  // Absent and empty are different claims. Without .min(1), `ingestion: ""`
  // silently became a null cell while `gate: ""` reached the page as a blank.
  assert.throws(
    () => parseMatrixDefs(defs([{ id: "r1", label: "One", ingestion: "" }])),
    /ingestion/,
  );
  assert.throws(
    () => parseMatrixDefs(defs([{ id: "r1", label: "One", gate: "" }])),
    /gate/,
  );
});

// ---------------------------------------------------------------------------
// The asserted cells actually reach the output.
// ---------------------------------------------------------------------------

test("label: the defs label wins, and a bare column falls back to the row title", () => {
  const m = assembleMatrix({
    defs: parseMatrixDefs(defs([{ id: "r1", label: "Old knowledge base" }])),
    rows: [row(), row({ id: "r2", title: "Row Two", href: "sources/r2/" })],
    planned: [],
  });
  assert.equal(m.columns[0].label, "Old knowledge base"); // def.label
  assert.equal(m.columns[1].label, "Row Two"); // ?? r.title
});

test("ontology carries its ref as {text, ref}; without a ref, text alone", () => {
  const withRef = assembleMatrix({
    defs: parseMatrixDefs(
      defs([
        {
          id: "r1",
          label: "One",
          ontology: "toolkit 7-schema",
          ontology_ref: "docs/kms/INGEST-AGENT-BRIEF.md",
        },
      ]),
    ),
    rows: [row()],
    planned: [],
  });
  assert.deepEqual(withRef.columns[0].cells.ontology, {
    text: "toolkit 7-schema",
    ref: "docs/kms/INGEST-AGENT-BRIEF.md",
  });
  const bare = assembleMatrix({
    defs: parseMatrixDefs(
      defs([{ id: "r1", label: "One", ontology: "CRM rules" }]),
    ),
    rows: [row()],
    planned: [],
  });
  assert.deepEqual(bare.columns[0].cells.ontology, { text: "CRM rules" });
});

test("ingestion carries the asserted mechanism AND the computed detail together", () => {
  // Production's actual shape on every batched container — previously only the
  // detail-without-text and text-without-detail halves were covered.
  const m = assembleMatrix({
    defs: parseMatrixDefs(
      defs([{ id: "r1", label: "One", ingestion: "batch-1 complete" }]),
    ),
    rows: [row()],
    planned: [],
  });
  assert.deepEqual(m.columns[0].cells.ingestion, {
    text: "batch-1 complete",
    detail: "5 ingested · 1 merged · 4 excluded · 10 pending",
  });
});

test("store is null at zero objects — never the invented claim `0 typed objects`", () => {
  // regenerant-catalunya-repo is live at 0: it is carded and measured (330
  // files) but nothing is ingested yet, and "0 typed objects" would read as a
  // finding about the corpus rather than as work not yet done.
  const m = assembleMatrix({
    defs: parseMatrixDefs(defs([{ id: "r1", label: "One" }])),
    rows: [row({ objects_total: 0 })],
    planned: [],
  });
  assert.equal(m.columns[0].cells.store, null);
});

test("round-trip over the real matrix.yaml: refi-bcn-old-kb renders in full", () => {
  // Couples to the live store's counts on purpose — tests/kb-summary.test.mjs
  // already fails when src/data/kb-summary.json goes stale against it, so the
  // two paths cannot disagree here without that test saying so first.
  const col = matrixViewModel().columns.find((c) => c.id === "refi-bcn-old-kb");
  assert.deepEqual(col, {
    id: "refi-bcn-old-kb",
    label: "Old knowledge base",
    href: "sources/refi-bcn-old-kb/",
    steward: "ReFi BCN (Luiz Fernando)",
    planned: false,
    gate: null,
    owner: null,
    loop: null,
    cells: {
      location: {
        text: "repos/ReFi-Barcelona",
        href: "https://github.com/refibcn/ReFi-Barcelona",
        external: true,
      },
      origin: { text: "272 files" },
      ingestion: {
        text: "batch-1 complete",
        detail: "88 ingested · 9 merged · 175 excluded · 0 pending",
      },
      store: { text: "416 typed objects" },
      ontology: {
        text: "toolkit 7-schema",
        ref: "docs/kms/INGEST-AGENT-BRIEF.md",
      },
      review: { text: "362 raw · 104 high-risk unresolved" },
      internal: { text: "Review lens", href: "review/" },
      public: { text: "Knowledge — fail-closed", href: "knowledge/" },
    },
  });
});

test("round-trip: notion-refi-bcn carries its gate, owner and loop", () => {
  // The blocked column — the one whose gate and owner the page must show, and
  // the only one carrying a `loop` note.
  const col = matrixViewModel().columns.find((c) => c.id === "notion-refi-bcn");
  assert.equal(
    col.gate,
    "C1 — Review-flags data-model call (blocks the BD-2026-065 batch)",
  );
  assert.equal(col.owner, "Luiz + Giulio");
  assert.match(col.loop, /^Ingestion feeds CRM entity processing/);
  assert.equal(
    col.steward,
    "ReFi BCN team (Giulio — CRM/workspace restructuring lead)",
  );
  // Files are the wrong unit here, so the asserted origin stands.
  assert.match(col.cells.origin.text, /^~571 records/);
  assert.equal(col.cells.location, null);
});

test("round-trip: the footnote lists the infra repos in full", () => {
  assert.deepEqual(matrixViewModel().footnote, [
    {
      id: "refi-bcn",
      title: "ReFi BCN Organizational OS",
      role: "self",
      href: "sources/refi-bcn/",
    },
    {
      id: "refibcn-site",
      title: "ReFi BCN website (Astro)",
      role: "render-target",
      href: "sources/refibcn-site/",
    },
  ]);
});
