import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadKb, facets, graphData, connections } from "../src/lib/kb.mjs";
import { publishableKb } from "../src/lib/kb.mjs";
import {
  COLORS,
  escHtml,
  tagRowHtml,
  typedFieldsHtml,
} from "../src/lib/kb-render.mjs";

// fileURLToPath, not .pathname — the checkout path contains spaces ("03 Libraries").
const FIX = fileURLToPath(new URL("./fixtures/kb/", import.meta.url));

test("loadKb normalizes + sorts", () => {
  const o = loadKb(FIX);
  assert.equal(o.length, 3);
  assert.deepEqual(
    o.map((x) => x.title),
    ["Alpha Resource", "Zeta Resource", "Beta Signal"],
  );
  const z = o.find((x) => x.slug === "zeta-resource");
  assert.equal(z.high_risk, true);
  assert.equal(z.origin, "https://example.org/doc-a");
  assert.equal(z.summary, "A test guide about funding.");
  const a = o.find((x) => x.slug === "alpha-resource");
  assert.equal(a.summary, "A governance tool.");
  assert.equal(a.origin, "https://example.org/alpha");
  assert.equal(
    o.find((x) => x.slug === "beta-signal").subtype,
    "status-unknown",
  );
});

test("facets", () => {
  const f = facets(loadKb(FIX));
  assert.deepEqual(f.schemas, ["resource", "signal"]);
  assert.deepEqual(f.domains, ["funding", "governance"]);
  assert.equal(f.highRisk, 1);
});

test("graphData: same-source + shared-concept edges, deduped", () => {
  const o = loadKb(FIX);
  const g = graphData(o);
  assert.equal(g.nodes.length, 3);
  const keys = g.links
    .map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`)
    .sort();
  // zeta(1)+beta(2) share wo-aaa; zeta(1)+alpha(0) share concept "quadratic funding"
  assert.deepEqual(keys, ["0-1", "1-2"]);
  assert.equal(g.nodes[1].degree, 2);
});

test(
  "smoke: real store",
  { skip: !existsSync("../../data/kb/index.json") },
  () => {
    const o = loadKb("../../data/kb/");
    assert.equal(o.length, 422);
    assert.ok(o.every((x) => x.title && x.schema && x.slug));
    const g = graphData(o);
    assert.ok(
      g.links.length > 100 && g.links.length <= 4000,
      `links out of expected range: ${g.links.length}`,
    );
  },
);

// Synthetic normalized objects (loadKb output shape) — publishableKb is pure.
const mk = (over = {}) => ({
  id: "resource/x",
  schema: "resource",
  slug: "x",
  title: "X",
  subtype: "",
  domain: "",
  maturity: "reviewed",
  high_risk: false,
  summary: "",
  origin: "",
  ...over,
  raw: { publish: true, ai_assisted: false, ...(over.raw ?? {}) },
});
const boundary = (tier, raw = {}) =>
  mk({
    id: "public-use-boundary/b",
    schema: "public-use-boundary",
    slug: "b",
    maturity: "boundary",
    raw: { tier, ...raw },
  });

test("publishableKb: fully-cleared reviewed object passes", () => {
  assert.equal(publishableKb([mk()]).length, 1);
});

test("publishableKb: default-deny branches", () => {
  assert.equal(publishableKb([mk({ maturity: "raw" })]).length, 0, "raw");
  assert.equal(
    publishableKb([mk({ maturity: "weird-state" })]).length,
    0,
    "unknown maturity",
  );
  assert.equal(
    publishableKb([mk({ raw: { ai_assisted: true } })]).length,
    0,
    "ai_assisted uncleared",
  );
  assert.equal(
    publishableKb([mk({ raw: { publish: false } })]).length,
    0,
    "publish false",
  );
  assert.equal(
    publishableKb([mk({ raw: { publish: undefined } })]).length,
    0,
    "publish missing",
  );
  assert.equal(
    publishableKb([boundary("public")]).length,
    0,
    "boundaries never render",
  );
});

test("publishableKb: paired boundary verdicts (via shared work_order)", () => {
  const obj = mk({ raw: { work_order: "wo-1" } });
  const internalB = boundary("internal-only", { work_order: "wo-1" });
  const publicB = boundary("public", { work_order: "wo-1" });
  assert.equal(
    publishableKb([obj, internalB]).length,
    0,
    "internal boundary denies",
  );
  assert.equal(
    publishableKb([obj, boundary("garbled???", { work_order: "wo-1" })]).length,
    0,
    "uninterpretable tier denies",
  );
  assert.equal(
    publishableKb([obj, publicB]).length,
    1,
    "public boundary allows",
  );
});

test("publishableKb: high-risk requires explicit public boundary", () => {
  const hr = mk({ high_risk: true, raw: { work_order: "wo-2" } });
  assert.equal(publishableKb([hr]).length, 0, "high-risk w/o boundary denies");
  assert.equal(
    publishableKb([hr, boundary("public", { work_order: "wo-2" })]).length,
    1,
    "cleared high-risk passes",
  );
});

test(
  "publishableKb: real store yields ZERO public objects today",
  { skip: !existsSync("../../data/kb/index.json") },
  () => {
    assert.equal(publishableKb(loadKb("../../data/kb/")).length, 0);
  },
);

// connections() operates on normalized objects (loadKb output shape).
const n = (title, slug, raw = {}) => ({ title, slug, schema: "resource", raw });

test("connections: resolves related_concepts by title (case-insensitive) + backlinks", () => {
  const objs = [
    n("Quadratic Funding", "qf"),
    n("Round", "round", {
      related_concepts: ["Quadratic Funding", "Nonexistent Concept"],
      work_order: "wo-1",
    }),
    n("Other", "other", {
      related_concepts: ["quadratic  funding"],
      work_order: "wo-1",
    }),
  ];
  const c = connections(objs);
  assert.deepEqual(c.out[1], [0], "Round → Quadratic Funding");
  assert.deepEqual(c.out[2], [0], "case/space-insensitive match");
  assert.deepEqual(
    c.unresolved[1],
    ["Nonexistent Concept"],
    "missing title stays unresolved",
  );
  assert.deepEqual(
    [...c.backlinks[0]].sort(),
    [1, 2],
    "QF is referenced by both",
  );
  assert.deepEqual(
    c.siblings[1],
    [2],
    "same work_order sibling, not a concept link",
  );
  assert.deepEqual(c.siblings[0], [], "no work_order/origin → no siblings");
});

test("connections: self-reference never links or reports unresolved", () => {
  const c = connections([n("Loop", "loop", { related_concepts: ["Loop"] })]);
  assert.deepEqual(c.out[0], []);
  assert.deepEqual(c.unresolved[0], []);
  assert.deepEqual(c.backlinks[0], []);
});

test("connections: dup titles resolve to the first; sibling excludes concept-linked", () => {
  const objs = [
    n("Dup", "dup-a"),
    n("Dup", "dup-b"),
    n("Ref", "ref", { related_concepts: ["Dup"] }),
  ];
  const c = connections(objs);
  assert.deepEqual(c.out[2], [0], "first Dup wins");
  assert.deepEqual(c.backlinks[0], [2]);
  assert.deepEqual(c.backlinks[1], []);
});

test(
  "connections: on the real store, every out-link index is valid",
  { skip: !existsSync("../../data/kb/index.json") },
  () => {
    const o = loadKb("../../data/kb/");
    const c = connections(o);
    assert.equal(c.out.length, o.length);
    const someResolved = c.out.reduce((a, l) => a + l.length, 0);
    assert.ok(someResolved > 0, "expected some related_concepts to resolve");
    for (const list of c.out)
      for (const j of list) assert.ok(j >= 0 && j < o.length, "valid index");
  },
);

test("public lens: connections over publishableKb never link to non-public objects", () => {
  // Two publishable objects linking to each other + to a non-public title.
  const A = mk({
    id: "resource/a",
    slug: "a",
    title: "Alpha",
    raw: {
      publish: true,
      ai_assisted: false,
      related_concepts: ["Beta", "Secret Draft"],
    },
  });
  const B = mk({
    id: "resource/b",
    slug: "b",
    title: "Beta",
    raw: { publish: true, ai_assisted: false, related_concepts: ["Alpha"] },
  });
  const secret = mk({
    id: "resource/secret",
    slug: "secret",
    title: "Secret Draft",
    maturity: "raw",
    raw: { publish: false },
  });
  const pub = publishableKb([A, B, secret]);
  assert.equal(pub.length, 2, "only A + B publish");
  const c = connections(pub);
  const ai = pub.findIndex((o) => o.slug === "a");
  assert.equal(c.out[ai].length, 1, "Alpha links only to the public Beta");
  assert.equal(pub[c.out[ai][0]].slug, "b");
  assert.deepEqual(
    c.unresolved[ai],
    ["Secret Draft"],
    "the non-public title stays unresolved text, never a path",
  );
});

test("kb-render: typedFieldsHtml orders by schema + omits related_concepts", () => {
  const o = mk({
    schema: "claim-evidence",
    raw: {
      interpretation: "I",
      claim: "C",
      evidence: "E",
      uncertainty: "U",
      related_concepts: ["X"],
      provenance: { origin: "o" },
    },
  });
  const html = typedFieldsHtml(o);
  assert.ok(
    html.indexOf("claim") < html.indexOf("evidence"),
    "claim before evidence (schema order)",
  );
  assert.ok(
    html.indexOf("evidence") < html.indexOf("interpretation"),
    "evidence before interpretation",
  );
  assert.ok(html.includes("provenance"), "provenance rendered");
  assert.ok(
    !html.includes(">related concepts<") && !html.includes("related_concepts"),
    "related_concepts omitted (shown as connections)",
  );
});

test("kb-render: colors cover all 7 schemas; tagRow escapes", () => {
  for (const s of [
    "claim-evidence",
    "concept-lineage",
    "encyclopedia-entry",
    "public-use-boundary",
    "resource",
    "signal",
    "source-system",
  ])
    assert.match(COLORS[s] ?? "", /^#[0-9A-Fa-f]{6}$/, s);
  assert.equal(escHtml('<b>"x"&'), "&lt;b&gt;&quot;x&quot;&amp;");
  const html = tagRowHtml(
    mk({ subtype: "<script>", domain: "funding", high_risk: true }),
  );
  assert.ok(
    html.includes("&lt;script&gt;") &&
      html.includes("high-risk") &&
      !html.includes("<script>"),
  );
});
