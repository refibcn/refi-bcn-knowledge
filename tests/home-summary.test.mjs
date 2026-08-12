// Home summary: the derivations behind the home page's reconciliation prose.
// The invariants worth pinning: a second `loop:` note is never silently
// dropped (the reason this returns a list rather than a `.find()`); planned
// columns are counted by the matrix and by nothing else; and — the one that
// matters — the strip-vs-matrix identity is COMPUTED, so the page can refuse
// to state arithmetic that has stopped being true. The failing case is real,
// not hypothetical: a `matrix.yaml` column naming an infrastructure container
// renders it as both a column and a footnote entry, and the prose would
// otherwise print a confident, wrong sum.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loopNotes, containerCounts } from "../src/lib/home-summary.mjs";
import { matrixViewModel } from "../src/lib/matrix.mjs";
import { sourcesViewModel } from "../src/lib/sources.mjs";

const carded = (id, over = {}) => ({ id, planned: false, ...over });
const planned = (id, over = {}) => ({ id, planned: true, ...over });

test("loopNotes returns nothing when no column declares a loop", () => {
  assert.deepEqual(loopNotes([carded("a"), planned("b")]), []);
});

test("loopNotes ignores null and empty loop values", () => {
  // `null` is the assembler's own "not declared"; "" would be a defs typo.
  // Neither may render as a blank emphasised sentence at the top of the page.
  assert.deepEqual(
    loopNotes([carded("a", { loop: null }), carded("b", { loop: "" })]),
    [],
  );
});

test("loopNotes returns the single declared loop", () => {
  assert.deepEqual(loopNotes([carded("a"), carded("b", { loop: "x ↔ y" })]), [
    "x ↔ y",
  ]);
});

test("loopNotes keeps EVERY loop, in column order — a second is not dropped", () => {
  // The regression this shape exists to prevent: `.find()` would return only
  // "first" and the page would silently lose a stated relationship.
  assert.deepEqual(
    loopNotes([
      carded("a", { loop: "first" }),
      planned("b"),
      carded("c", { loop: "second" }),
    ]),
    ["first", "second"],
  );
});

test("containerCounts splits carded from planned", () => {
  const c = containerCounts({
    columns: [carded("a"), carded("b"), planned("c")],
    footnote: [{ id: "x" }],
    containers: 3,
  });
  assert.equal(c.carded, 2);
  assert.equal(c.planned, 1);
  assert.equal(c.infrastructure, 1);
  assert.equal(c.containers, 3);
});

test("containerCounts reconciles when the strip is carded + infrastructure", () => {
  const c = containerCounts({
    columns: [carded("a"), carded("b"), planned("c"), planned("d")],
    footnote: [{ id: "x" }, { id: "y" }],
    containers: 4, // 2 carded + 2 infrastructure; the 2 planned have no card
  });
  assert.equal(c.reconciles, true);
});

test("planned columns are counted by the matrix and by nothing else", () => {
  // Adding a planned column must NOT break the identity — it has no card, so
  // sourcesViewModel never counted it. If this ever fails, the prose would
  // start declaring a fault every time a planned container is added.
  const base = [carded("a"), carded("b")];
  const footnote = [{ id: "x" }];
  const before = containerCounts({ columns: base, footnote, containers: 3 });
  const after = containerCounts({
    columns: [...base, planned("new")],
    footnote,
    containers: 3,
  });
  assert.equal(before.reconciles, true);
  assert.equal(after.reconciles, true);
  assert.equal(after.planned, before.planned + 1);
});

test("containerCounts FAILS to reconcile when a column double-counts a footnote container", () => {
  // The concrete scenario: a defs column for `refibcn-site`. matrix.mjs
  // reaches it by id regardless of role, so it becomes a carded column, while
  // `footnote` still lists it because its role is not "source". carded (3) +
  // infrastructure (2) = 5, but /sources only ever counted 4 containers.
  const c = containerCounts({
    columns: [carded("old-kb"), carded("crm"), carded("refibcn-site")],
    footnote: [{ id: "refi-bcn" }, { id: "refibcn-site" }],
    containers: 4,
  });
  assert.equal(c.reconciles, false);
  // Every individual number stays correct — that is exactly why the sum has
  // to be checked rather than trusted.
  assert.equal(c.carded, 3);
  assert.equal(c.infrastructure, 2);
  assert.equal(c.containers, 4);
});

test("containerCounts fails closed when a container is missing from both", () => {
  const c = containerCounts({
    columns: [carded("a")],
    footnote: [],
    containers: 2,
  });
  assert.equal(c.reconciles, false);
});

test("containerCounts handles an empty matrix without inventing a reconciliation", () => {
  const c = containerCounts({ columns: [], footnote: [], containers: 0 });
  assert.equal(c.carded, 0);
  assert.equal(c.planned, 0);
  assert.equal(c.reconciles, true);
});

test("the live view-models reconcile — the home page states the arithmetic", () => {
  // The end-to-end claim: with the committed matrix.yaml and the real source
  // rows, the identity holds, so the page renders prose rather than a fault.
  // If someone adds a defs column for an infrastructure container, THIS is
  // the test that names why the home page changed.
  const m = matrixViewModel();
  const src = sourcesViewModel();
  const c = containerCounts({
    columns: m.columns,
    footnote: m.footnote,
    containers: src.totals.containers,
  });
  assert.equal(
    c.reconciles,
    true,
    `containers ${c.containers} !== carded ${c.carded} + infrastructure ${c.infrastructure}`,
  );
  assert.ok(c.carded > 0, "the matrix must hold at least one carded container");
});
