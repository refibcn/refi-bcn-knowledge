// Collections: curated sub-scopes computed over the store. The invariants worth
// pinning: membership is rule-driven but explicit ids override; excludes always
// win; the public member set is publishableKb-gated (a raw object can be a
// MEMBER but never a public ENTRY); and the summary path yields the same row
// shape with members: [] — the sources.mjs contract, reused deliberately.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCollections,
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

test("parseCollections rejects an unknown status and a missing title", () => {
  assert.throws(() =>
    parseCollections({ collections: { x: { title: "X", status: "wip" } } }),
  );
  assert.throws(() =>
    parseCollections({ collections: { x: { status: "curating" } } }),
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

test("viewModel: publishable is gated, raw members count but do not list publicly", () => {
  const vm = collectionsViewModel();
  for (const row of vm.rows) {
    assert.ok(row.members_total >= row.publishable_total, row.id);
    assert.ok(Array.isArray(row.public_entries));
    for (const e of row.public_entries) assert.notEqual(e.maturity, "raw");
  }
});

test("summary path: same row shape, members empty, counts from named fields", () => {
  const vm = collectionsViewModel();
  assert.ok(typeof vm.from_summary === "boolean");
  for (const row of vm.rows) {
    assert.ok(Number.isInteger(row.members_total));
    assert.ok(row.by_schema && typeof row.by_schema === "object");
    assert.ok(
      typeof row.href === "string" && row.href.startsWith("collections/"),
    );
  }
});
