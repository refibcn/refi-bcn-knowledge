import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toMarkers,
  AGENCY_PRECEDENCE,
  actorAnchor,
} from "../src/lib/atlas-data.mjs";

// `atlas-data` is .mjs rather than .ts for the same reason `kb.mjs` is: the
// repo's runner is plain `node --test tests/*.test.mjs`, and Node cannot import
// TypeScript. Types are carried in JSDoc instead.

const rec = (p) => ({
  id: "x",
  url: "",
  createdTime: "",
  lastEditedTime: "",
  properties: p,
});

test("record with Lat/Lng becomes a marker with agency-derived category", () => {
  const m = toMarkers([
    rec({ Name: "Coop57", Lat: 41.38, Lng: 2.17, Tags: ["org", "funder"] }),
  ]);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0], {
    name: "Coop57",
    lat: 41.38,
    lng: 2.17,
    category: "funder",
    tags: ["org", "funder"],
  });
});

test("records without geo are dropped, not errored", () => {
  assert.equal(toMarkers([rec({ Name: "NoGeo" })]).length, 0);
});

// ── Precedence ────────────────────────────────────────────────────────────
// `agency` is multi-valued (91 of 608 live CRM records carry 2+ values), so the
// legend needs a deterministic winner per record.

test("precedence order is the D9 legend taxonomy", () => {
  assert.deepEqual(AGENCY_PRECEDENCE, [
    "funder",
    "public body",
    "network/ecosystem",
    "space",
    "org",
    "ind",
  ]);
});

test("category follows precedence, not the order values appear on the record", () => {
  const geo = { Lat: 1, Lng: 2 };
  const categoryOf = (agency) =>
    toMarkers([rec({ Name: "n", ...geo, Agency: agency })])[0].category;

  assert.equal(categoryOf(["ind", "space"]), "space");
  assert.equal(categoryOf(["org", "public body"]), "public body");
  assert.equal(categoryOf(["network/ecosystem", "funder", "org"]), "funder");
  assert.equal(categoryOf(["ind"]), "ind");
});

test("Agency is preferred over Tags as the agency vocabulary", () => {
  const m = toMarkers([
    rec({ Name: "n", Lat: 1, Lng: 2, Agency: ["space"], Tags: ["funder"] }),
  ]);
  assert.equal(m[0].category, "space");
  assert.deepEqual(m[0].tags, ["space"]);
});

test("unknown or absent agency values yield a null category, not a guess", () => {
  const m = toMarkers([
    rec({ Name: "n", Lat: 1, Lng: 2, Agency: ["something-else"] }),
  ]);
  assert.equal(m[0].category, null);
  assert.deepEqual(m[0].tags, ["something-else"]);

  const bare = toMarkers([rec({ Name: "n", Lat: 1, Lng: 2 })]);
  assert.equal(bare[0].category, null);
  assert.deepEqual(bare[0].tags, []);
});

// ── Geo coercion ──────────────────────────────────────────────────────────

test("numeric strings are accepted; non-numeric and out-of-range geo is dropped", () => {
  assert.equal(
    toMarkers([rec({ Name: "n", Lat: "41.38", Lng: "2.17" })])[0].lat,
    41.38,
  );
  assert.equal(
    toMarkers([rec({ Name: "n", Lat: "abc", Lng: "2.17" })]).length,
    0,
  );
  assert.equal(
    toMarkers([rec({ Name: "n", Lat: 41.38, Lng: null })]).length,
    0,
  );
  assert.equal(toMarkers([rec({ Name: "n", Lat: 999, Lng: 2.17 })]).length, 0);
});

test("a record with geo but no name is dropped", () => {
  assert.equal(toMarkers([rec({ Lat: 41.38, Lng: 2.17 })]).length, 0);
});

test("toMarkers tolerates an empty list", () => {
  assert.deepEqual(toMarkers([]), []);
});

// ── Anchor helper ─────────────────────────────────────────────────────────
// The marker shape is fixed to five keys, so popups cannot carry a Notion id.
// Both the atlas popup and the organizations card derive the same anchor from
// the actor name via this one helper.

test("actorAnchor slugifies a name deterministically", () => {
  assert.equal(actorAnchor("Coop57"), "actor-coop57");
  assert.equal(
    actorAnchor("La Fundició / Keras Buti"),
    "actor-la-fundicio-keras-buti",
  );
  assert.equal(actorAnchor("  Spaced  Out  "), "actor-spaced-out");
});
