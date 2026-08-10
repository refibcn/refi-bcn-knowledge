// Collections: curated sub-scopes computed over the store. The invariants worth
// pinning: membership is rule-driven but explicit ids override; excludes always
// win; a typo'd include/exclude key fails CLOSED (not open to the whole store);
// the public member set is publishableKb-gated (a raw object can be a MEMBER
// but never a public ENTRY); the summary path reads counts from the committed
// rollup rather than degrading to zero when it is absent; and both paths yield
// the identical row shape for the same objects — the single assertion that
// would have caught the "Sources 0" class of incident this module is built to
// avoid repeating (see collections.mjs's module header).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCollections,
  loadCollections,
  collectionMembers,
  collectionsViewModel,
} from "../src/lib/collections.mjs";
import { resolveKbDir, PUBLIC_KB_DIR } from "../src/lib/kb.mjs";

// House pattern (tests/kb-sources.test.mjs, tests/archive-ready.test.mjs): a
// standalone CI clone has no workspace store, so any test that calls
// collectionsViewModel() with its DEFAULT `objects`/`fromSummary` reads the
// committed summary — which legitimately has no `collections` rollup until
// T1.2 lands it, and correctly throws. That is the module working as
// designed, not a test failure, so the test self-skips instead of asserting
// against a store that is not there. Tests that inject their own
// objects/summary/defs are unaffected by this and must NOT skip — the whole
// point of the injectables is that they run everywhere.
const noWorkspace = resolveKbDir() === PUBLIC_KB_DIR;

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

test(
  "viewModel over the real store: publishable is gated, raw members count but do not list publicly",
  { skip: noWorkspace },
  () => {
    const vm = collectionsViewModel();
    for (const row of vm.rows) {
      assert.ok(row.members_total >= row.publishable_total, row.id);
      assert.ok(Array.isArray(row.public_entries));
      for (const e of row.public_entries) assert.notEqual(e.maturity, "raw");
    }
  },
);

test("the real collections.yaml parses to at least one collection", () => {
  assert.ok(Object.keys(loadCollections()).length > 0);
});

test("loadCollections names the missing file rather than a bare ENOENT", () => {
  assert.throws(
    () => loadCollections("/nonexistent/path/collections.yaml"),
    /nonexistent\/path\/collections\.yaml/,
  );
});

test("summary path reads counts from the injected rollup, not from computed members", () => {
  const defs = parseCollections({
    collections: { c: { title: "C", status: "curating" } },
  });
  const vm = collectionsViewModel({
    objects: [],
    fromSummary: true,
    defs,
    summary: {
      collections: {
        c: {
          members_total: 15,
          publishable_total: 0,
          by_schema: { resource: 15 },
          by_container: { x: 15 },
        },
      },
    },
  });
  assert.equal(vm.rows[0].members_total, 15);
  assert.equal(vm.rows[0].publishable_total, 0);
  assert.deepEqual(vm.rows[0].by_schema, { resource: 15 });
});

test("summary path throws when the committed rollup carries no `collections` key — never degrades to zero", () => {
  const defs = parseCollections({
    collections: { c: { title: "C", status: "curating" } },
  });
  assert.throws(
    () =>
      collectionsViewModel({
        objects: [],
        fromSummary: true,
        defs,
        summary: {},
      }),
    /carries no `collections` rollup/,
  );
});

test("summary path throws when a specific collection has no rollup entry — never degrades to zero", () => {
  const defs = parseCollections({
    collections: { c: { title: "C", status: "curating" } },
  });
  assert.throws(
    () =>
      collectionsViewModel({
        objects: [],
        fromSummary: true,
        defs,
        summary: { collections: {} },
      }),
    /no rollup for collection "c"/,
  );
});

test("summary path throws when a rollup entry is missing members_total — present is not the same as well-shaped", () => {
  const defs = parseCollections({
    collections: { c: { title: "C", status: "curating" } },
  });
  assert.throws(() =>
    collectionsViewModel({
      objects: [],
      fromSummary: true,
      defs,
      summary: {
        collections: {
          c: { publishable_total: 0, by_schema: {}, by_container: {} },
        },
      },
    }),
  );
});

test("summary path throws on the objects_total-instead-of-members_total trap — the containers rollup's key name, not the collections rollup's", () => {
  // derive-kb-summary.mjs's CONTAINER_KEYS names its count `objects_total`.
  // A collections rollup that reused that shape by habit is caught here by
  // the REQUIRED `members_total` field being absent — with or without
  // `.strict()` on RollupSchema. `.strict()` earns its place on a different
  // ground (rejecting an otherwise-correct rollup carrying an extra,
  // unaccounted-for field) — see the comment on RollupSchema in collections.mjs.
  const defs = parseCollections({
    collections: { c: { title: "C", status: "curating" } },
  });
  assert.throws(() =>
    collectionsViewModel({
      objects: [],
      fromSummary: true,
      defs,
      summary: {
        collections: {
          c: {
            objects_total: 15,
            publishable_total: 0,
            by_schema: {},
            by_container: {},
          },
        },
      },
    }),
  );
});

test("cross-path agreement: live and summary yield identical counts, ENTRIES, and row shape for the same objects", () => {
  // This is the test the C2 fork bug would fail: a mutant that hard-codes
  // `members: []` / `public_entries: []` on the summary path changes no key
  // NAME, and the four counts still come from the injected rollup either way
  // — so key-set equality and count equality alone cannot catch it. What
  // catches it is comparing the actual entry ids, and only on a fixture where
  // publishable_total is non-zero (otherwise `public_entries` is `[]` on both
  // sides regardless of whether the fork is present).
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
    fromSummary: false,
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

  const summary = collectionsViewModel({
    objects,
    fromSummary: true,
    defs,
    internal: true,
    summary: { collections: { c: expected } },
  }).rows[0];
  assert.equal(summary.members_total, expected.members_total);
  assert.equal(summary.publishable_total, expected.publishable_total);
  assert.deepEqual(summary.by_schema, expected.by_schema);
  assert.deepEqual(summary.by_container, expected.by_container);

  // The entries themselves — not just the counts — must agree between the
  // two paths. This is the assertion a members:[]/public_entries:[] fork on
  // the summary branch would fail.
  assert.deepEqual(
    summary.members.map((m) => m.id).sort(),
    live.members.map((m) => m.id).sort(),
  );
  assert.deepEqual(
    summary.public_entries.map((m) => m.id).sort(),
    live.public_entries.map((m) => m.id).sort(),
  );
  assert.deepEqual(Object.keys(summary).sort(), Object.keys(live).sort());

  // A third, `internal: false` call — the actual PUBLIC row shape. This is
  // the only test exercising that branch of `members: internal ? members : []`
  // with a non-empty member set; every other `.members` assertion above runs
  // under `internal: true`. Two separate claims: member BODIES are gated...
  const publicRow = collectionsViewModel({
    objects,
    fromSummary: false,
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
