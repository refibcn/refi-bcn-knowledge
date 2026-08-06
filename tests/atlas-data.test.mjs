import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toMarkers,
  AGENCY_PRECEDENCE,
  actorAnchor,
  toComarcaPlacements,
  largestRingCentroid,
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

// ── Comarca placement ─────────────────────────────────────────────────────
// The CRM has no point coordinates, but 125 of 608 records carry an `Area2`
// multi-select whose comarca options match the atlas geojson's `nom_comar`
// values. That join is the only real geography available today.

/** Stand-in for the name set read off the geojson at build time. */
const INDEX = ["Barcelonès", "Osona", "Baix Llobregat", "Selva", "Val d'Aran"];

test("a record's Area2 comarca becomes a placement with its actor", () => {
  const out = toComarcaPlacements(
    [rec({ Name: "Coop57", Area2: ["Barcelonès"], Agency: ["funder", "org"] })],
    INDEX,
  );
  assert.deepEqual(out, [
    {
      comarca: "Barcelonès",
      actors: [{ name: "Coop57", category: "funder", tags: ["funder", "org"] }],
    },
  ]);
});

test("a record matching several comarques appears in each", () => {
  const out = toComarcaPlacements(
    [rec({ Name: "Wide", Area2: ["Osona", "Barcelonès"], Agency: ["org"] })],
    INDEX,
  );
  assert.deepEqual(out.map((p) => p.comarca).sort(), ["Barcelonès", "Osona"]);
  for (const placement of out) {
    assert.deepEqual(placement.actors, [
      { name: "Wide", category: "org", tags: ["org"] },
    ]);
  }
});

test("province- and region-only records are dropped, not placed", () => {
  // These are the real unmatched values: 46 records carry `regional`, one
  // carries `Lleida province`. Neither is a polygon; inventing one would be
  // fabricating geography.
  const out = toComarcaPlacements(
    [
      rec({ Name: "Regional", Area2: ["regional"] }),
      rec({ Name: "Provincial", Area2: ["Lleida province"] }),
    ],
    INDEX,
  );
  assert.deepEqual(out, []);
});

test("records with no Area2, an unknown comarca, or no name are dropped", () => {
  assert.deepEqual(toComarcaPlacements([rec({ Name: "Bare" })], INDEX), []);
  assert.deepEqual(
    toComarcaPlacements([rec({ Name: "X", Area2: ["Atlantis"] })], INDEX),
    [],
  );
  assert.deepEqual(
    toComarcaPlacements([rec({ Area2: ["Osona"] })], INDEX),
    [],
    "a record with no name is dropped, as in toMarkers",
  );
});

test("placement categories use the same AGENCY_PRECEDENCE as markers", () => {
  const out = toComarcaPlacements(
    [rec({ Name: "A", Area2: ["Osona"], Agency: ["ind", "public body"] })],
    INDEX,
  );
  assert.equal(out[0].actors[0].category, "public body");
});

test("comarques are ranked by actor count, then name; actors sorted by name", () => {
  const out = toComarcaPlacements(
    [
      rec({ Name: "Zed", Area2: ["Barcelonès"] }),
      rec({ Name: "Ann", Area2: ["Barcelonès"] }),
      rec({ Name: "Solo", Area2: ["Osona"] }),
      rec({ Name: "Other", Area2: ["Baix Llobregat"] }),
    ],
    INDEX,
  );
  assert.deepEqual(
    out.map((p) => [p.comarca, p.actors.length]),
    [
      ["Barcelonès", 2],
      ["Baix Llobregat", 1],
      ["Osona", 1],
    ],
  );
  assert.deepEqual(
    out[0].actors.map((a) => a.name),
    ["Ann", "Zed"],
  );
});

test("matching tolerates case and whitespace, and the two CRM label variants", () => {
  // The CRM's Area2 options spell two comarques differently from the geojson:
  // "La Selva" vs "Selva" and "Aran" vs "Val d'Aran". Same territory, different
  // label. Lluçanès and Moianès are deliberately NOT aliased — they are real
  // comarques with no polygon in this geojson, so mapping them anywhere would
  // be wrong, not lenient.
  const out = toComarcaPlacements(
    [
      rec({ Name: "A", Area2: ["  barcelonÈs "] }),
      rec({ Name: "B", Area2: ["La Selva"] }),
      rec({ Name: "C", Area2: ["Aran"] }),
      rec({ Name: "D", Area2: ["Lluçanès"] }),
    ],
    INDEX,
  );
  assert.deepEqual(out.map((p) => p.comarca).sort(), [
    "Barcelonès",
    "Selva",
    "Val d'Aran",
  ]);
});

test("toComarcaPlacements accepts a Set index and tolerates empty input", () => {
  assert.deepEqual(toComarcaPlacements([], new Set(INDEX)), []);
  const out = toComarcaPlacements(
    [rec({ Name: "A", Area2: ["Osona"] })],
    new Set(INDEX),
  );
  assert.equal(out[0].comarca, "Osona");
});

// ── Centroid ──────────────────────────────────────────────────────────────
// Count badges sit at the centroid of a comarca's largest polygon. Nine of the
// 50 geojson features share a name with an exclave, so "largest" is what keeps
// one badge per comarca instead of one per landmass.

test("largestRingCentroid picks the biggest polygon and centres it", () => {
  const bigSquare = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ];
  const tinyExclave = [
    [
      [100, 100],
      [101, 100],
      [101, 101],
      [100, 101],
      [100, 100],
    ],
  ];
  const centroid = largestRingCentroid({
    type: "MultiPolygon",
    coordinates: [tinyExclave, bigSquare],
  });
  assert.deepEqual(centroid, [5, 5]);
});

test("largestRingCentroid handles a plain Polygon and rejects junk", () => {
  assert.deepEqual(
    largestRingCentroid({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    }),
    [2, 2],
  );
  assert.equal(
    largestRingCentroid({ type: "Point", coordinates: [1, 2] }),
    null,
  );
  assert.equal(largestRingCentroid(null), null);
});
