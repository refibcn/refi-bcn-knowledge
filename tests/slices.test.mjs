// tests/slices.test.mjs — crosscuts are pure functions over objects/rows; the
// invariant is arithmetic honesty: every matrix row/column sums to its total.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  domainMatrix,
  maturityFunnel,
  highRiskQueue,
  boundaryTiers,
} from "../src/lib/slices.mjs";

const o = (schema, domain, maturity = "raw", high_risk = false) => ({
  id: `${schema}/${Math.random()}`,
  schema,
  domain,
  maturity,
  high_risk,
});

test("domainMatrix: cells sum to row and column totals; blank domain becomes 'unset'", () => {
  const m = domainMatrix([
    o("resource", "a"),
    o("signal", "a"),
    o("resource", ""),
  ]);
  assert.deepEqual(m.domains, ["a", "unset"]);
  assert.equal(m.cell("a", "resource"), 1);
  assert.equal(m.rowTotal("a"), 2);
  assert.equal(
    m.domains.reduce((n, d) => n + m.rowTotal(d), 0),
    3,
  );
});

test("maturityFunnel: per-container raw/reviewed/published, from by_maturity rollups", () => {
  const rows = [
    {
      id: "x",
      title: "X",
      by_maturity: { raw: 3, reviewed: 1 },
      objects_total: 4,
    },
  ];
  const f = maturityFunnel(rows);
  assert.deepEqual(f[0], {
    id: "x",
    title: "X",
    raw: 3,
    reviewed: 1,
    published: 0,
    total: 4,
  });
});

test("highRiskQueue: unresolved = high-risk still raw; never negative", () => {
  const rows = [
    { id: "x", title: "X", high_risk_count: 5, unresolved_high_risk: 4 },
  ];
  assert.deepEqual(highRiskQueue(rows)[0], {
    id: "x",
    title: "X",
    total: 5,
    unresolved: 4,
    resolved: 1,
  });
});

test("highRiskQueue: throws on an absent unresolved count rather than inventing 0", () => {
  // Same doctrine as archiveReady(): absent is a statement about the build,
  // 0 is a claim about the corpus. Never confuse them.
  assert.throws(() =>
    highRiskQueue([{ id: "x", title: "X", high_risk_count: 5 }]),
  );
});

test("boundaryTiers counts public-use-boundary objects by tier", () => {
  const t = boundaryTiers([
    { schema: "public-use-boundary", raw: { tier: "public" } },
    { schema: "public-use-boundary", raw: { tier: "internal" } },
    { schema: "resource", raw: { tier: "public" } }, // not a boundary — ignored
  ]);
  assert.deepEqual(t, { public: 1, internal: 1 });
});
