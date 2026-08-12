// Collections: curated sub-scopes computed over the store. The invariants worth
// pinning: membership is rule-driven but explicit ids override; excludes always
// win; a typo'd include/exclude key fails CLOSED (not open to the whole store);
// the public member set is publishableKb-gated (a raw object can be a MEMBER
// but never a public ENTRY); and the public row shape gates member BODIES
// without also hiding publishable ENTRIES. The store lives in this repo (kb/),
// so nothing here needs a workspace guard — every test runs everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCollections,
  loadCollections,
  collectionMembers,
  collectionsViewModel,
} from "../src/lib/collections.mjs";

const o = (schema, slug, extra = {}) => ({
  id: `${schema}/${slug}`,
  schema,
  slug,
  title: slug,
  subtype: "",
  domain: "",
  maturity: "raw",
  high_risk: false,
  summary: "",
  origin: "",
  raw: {},
  ...extra,
});
const containerOf = (id) =>
  id.startsWith("resource/") ? "refi-bcn-old-kb" : "notion-refi-bcn";

// A minimal source-system card, in the same shape loadKb() produces, so a
// fixture object set can drive real sourceContainers() attribution instead of
// a hand-rolled containerOf stub.
const card = (id, prefixes) => ({
  id: `source-system/${id}`,
  schema: "source-system",
  slug: id,
  title: id,
  subtype: "",
  domain: "",
  maturity: "reviewed",
  high_risk: false,
  summary: "",
  origin: "",
  raw: { origin_prefixes: prefixes },
});

test("parseCollections rejects an unknown status and a missing title", () => {
  assert.throws(() =>
    parseCollections({ collections: { x: { title: "X", status: "wip" } } }),
  );
  assert.throws(() =>
    parseCollections({ collections: { x: { status: "curating" } } }),
  );
});

test("parseCollections throws on a null, empty, or missing `collections:` map — never returns {} silently", () => {
  assert.throws(() => parseCollections({ collections: null }));
  assert.throws(() => parseCollections({ collections: {} }));
  assert.throws(() => parseCollections({}));
  assert.throws(() => parseCollections(undefined));
});

test("a typo'd top-level include/exclude key fails closed, not open to the whole store", () => {
  // Reproduced in review: zod 3 strips unknown keys by default, and combined
  // with "empty axis = unconstrained" that turns `includes:`/`excludes:` (the
  // likeliest misspelling) into a collection matching every object in the
  // store with no error anywhere. `.strict()` must make this throw instead.
  assert.throws(() =>
    parseCollections({
      collections: {
        c: {
          title: "C",
          status: "curating",
          includes: { containers: ["x"] },
          excludes: { ids: ["y"] },
        },
      },
    }),
  );
});

test("a typo'd key nested inside include/exclude also fails closed", () => {
  assert.throws(() =>
    parseCollections({
      collections: {
        c: { title: "C", status: "curating", include: { containerz: ["x"] } },
      },
    }),
  );
});

test("membership: rules AND across axes, ids override, excludes always win", () => {
  const def = parseCollections({
    collections: {
      c: {
        title: "C",
        status: "curating",
        include: {
          containers: ["refi-bcn-old-kb"],
          domains: ["bioregionalism"],
          schemas: [],
          ids: ["signal/added-by-hand"],
        },
        exclude: { ids: ["resource/banned"] },
      },
    },
  }).c;
  const objects = [
    o("resource", "in", { domain: "bioregionalism" }),
    o("resource", "wrong-domain", { domain: "other" }),
    o("signal", "added-by-hand", { domain: "other" }),
    o("resource", "banned", { domain: "bioregionalism" }),
  ];
  const ids = collectionMembers(def, objects, containerOf).map((m) => m.id);
  assert.deepEqual(ids.sort(), ["resource/in", "signal/added-by-hand"]);
});

test("an empty axis constrains nothing", () => {
  const def = parseCollections({
    collections: {
      c: {
        title: "C",
        status: "defining",
        include: { containers: [], domains: [], schemas: [], ids: [] },
      },
    },
  }).c;
  assert.equal(
    collectionMembers(def, [o("resource", "a"), o("signal", "b")], containerOf)
      .length,
    2,
  );
});

test("source-system cards are never members", () => {
  const def = parseCollections({
    collections: { c: { title: "C", status: "defining" } },
  }).c;
  const objects = [
    o("source-system", "refi-bcn-old-kb"),
    o("resource", "real"),
  ];
  assert.deepEqual(
    collectionMembers(def, objects, containerOf).map((m) => m.id),
    ["resource/real"],
  );
});

test("viewModel over the real store: publishable is gated, raw members count but do not list publicly", () => {
  const vm = collectionsViewModel();
  for (const row of vm.rows) {
    assert.ok(row.members_total >= row.publishable_total, row.id);
    assert.ok(Array.isArray(row.public_entries));
    for (const e of row.public_entries) assert.notEqual(e.maturity, "raw");
  }
});

test("the real collections.yaml parses to at least one collection", () => {
  assert.ok(Object.keys(loadCollections()).length > 0);
});

test("loadCollections names the missing file rather than a bare ENOENT", () => {
  assert.throws(
    () => loadCollections("/nonexistent/path/collections.yaml"),
    /nonexistent\/path\/collections\.yaml/,
  );
});

test("counts, entries and the public row shape, over a fixture with a publishable member", () => {
  // The counts are computed from the same membership the entries render from,
  // and asserted against independently-derived expectations — not read back
  // off the row, which would just check the code agrees with itself.
  const defs = parseCollections({
    collections: {
      c: {
        title: "C",
        status: "curating",
        include: {
          containers: ["cardA"],
          domains: ["bioregionalism"],
          schemas: [],
          ids: [],
        },
      },
    },
  });
  const cardA = card("cardA", ["https://example.com/repoA/"]);
  const objects = [
    cardA,
    o("resource", "in", {
      domain: "bioregionalism",
      origin: "https://example.com/repoA/in",
    }),
    // Genuinely clears publishableKb() (src/lib/kb.mjs): `maturity: "reviewed"`
    // is in OK_MATURITY, `raw.publish === true`, `high_risk` is false so no
    // public-use-boundary pairing is required, and `ai_assisted` is unset.
    o("resource", "published-one", {
      domain: "bioregionalism",
      origin: "https://example.com/repoA/p",
      maturity: "reviewed",
      raw: { publish: true },
    }),
    o("resource", "wrong-domain", {
      domain: "other",
      origin: "https://example.com/repoA/wrong",
    }),
    o("signal", "other-container", {
      domain: "bioregionalism",
      origin: "https://elsewhere.example/x",
    }),
  ];
  // Independently derived, not read back off either row — otherwise the
  // assertion would just be checking that the code agrees with itself.
  const expected = {
    members_total: 2,
    publishable_total: 1,
    by_schema: { resource: 2 },
    by_container: { cardA: 2 },
  };
  const expectedMemberIds = ["resource/in", "resource/published-one"];
  const expectedPublicIds = ["resource/published-one"];

  const live = collectionsViewModel({
    objects,
    defs,
    internal: true,
  }).rows[0];
  assert.equal(live.members_total, expected.members_total);
  assert.equal(live.publishable_total, expected.publishable_total);
  assert.deepEqual(live.by_schema, expected.by_schema);
  assert.deepEqual(live.by_container, expected.by_container);
  assert.deepEqual(live.members.map((m) => m.id).sort(), expectedMemberIds);
  assert.deepEqual(
    live.public_entries.map((m) => m.id).sort(),
    expectedPublicIds,
  );

  // A second, `internal: false` call — the actual PUBLIC row shape. This is
  // the only test exercising that branch of `members: internal ? members : []`
  // with a non-empty member set; every other `.members` assertion above runs
  // under `internal: true`. Two separate claims: member BODIES are gated...
  const publicRow = collectionsViewModel({
    objects,
    defs,
  }).rows[0];
  assert.deepEqual(
    publicRow.members,
    [],
    "internal:false must not expose member bodies",
  );
  // ...but gating must not also hide the publishable ENTRIES — "gated" and
  // "blanked" are different failure modes and this distinguishes them.
  assert.deepEqual(
    publicRow.public_entries.map((m) => m.id).sort(),
    expectedPublicIds,
    "gating members must not also hide publishable entries",
  );
});
