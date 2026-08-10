// src/data/kb-summary.json is DERIVED data that is COMMITTED. That combination
// has exactly one failure mode worth testing for: it goes stale the moment
// data/kb/ changes, and nothing about a stale file looks wrong. A clone would go
// on rendering last month's counts, and the archive verdict would go on blocking
// (or not) on a high-risk number that no longer describes the store.
//
// So the first test recomputes the summary from the live store and demands the
// committed file agree — skipped, like every other store-dependent test here,
// when there is no workspace store to compare against.
//
// The rest pin the contract the fallback depends on: identical row shape, no
// object-level content, and a derivation that refuses to run against the empty
// public store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKb, sourceContainers } from "../src/lib/kb.mjs";
import {
  kbSummary,
  summaryContainers,
  SUMMARY_FILE,
} from "../src/lib/kb-summary.mjs";
import {
  deriveKbSummary,
  assertNoObjectLeak,
  OUT_FILE,
} from "../scripts/derive-kb-summary.mjs";
import {
  loadCollections,
  collectionsViewModel,
} from "../src/lib/collections.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const WORKSPACE_DIR = resolve(REPO_ROOT, "..", "..", "data", "kb");
const noWorkspace = !existsSync(WORKSPACE_DIR);

// ── Staleness ────────────────────────────────────────────────────────────

test(
  "the committed summary matches the live store (re-run `npm run derive:kb-summary`)",
  { skip: noWorkspace },
  () => {
    const fresh = deriveKbSummary(loadKb(WORKSPACE_DIR));
    const committed = JSON.parse(readFileSync(OUT_FILE, "utf8"));
    assert.deepEqual(
      committed,
      fresh,
      "src/data/kb-summary.json is stale — the store has moved since it was derived. " +
        "Run `npm run derive:kb-summary` (and `npm run derive:disposition`) and commit both.",
    );
  },
);

test("the reader and the deriver name the same file", () => {
  assert.equal(SUMMARY_FILE, OUT_FILE);
});

// ── The numbers the pages render ─────────────────────────────────────────

test(
  "summary aggregates equal the live store's own derivations",
  { skip: noWorkspace },
  () => {
    const objects = loadKb(WORKSPACE_DIR);
    const s = kbSummary();

    // Exactly what src/pages/knowledge.astro computes.
    assert.equal(s.objects_total, objects.length);
    assert.equal(
      s.in_review,
      objects.filter((o) => o.maturity === "raw").length,
    );
    for (const [schema, n] of Object.entries(s.by_schema)) {
      assert.equal(
        n,
        objects.filter((o) => o.schema === schema).length,
        `by_schema.${schema}`,
      );
    }

    // Exactly what sourceContainers() computes, container by container.
    const live = sourceContainers(objects);
    assert.deepEqual(
      s.containers.map((c) => c.id),
      live.map((c) => c.id),
      "container order must match — the pages render in array order",
    );
    for (const c of live) {
      const sc = s.containers.find((x) => x.id === c.id);
      assert.equal(sc.objects_total, c.objects.length, `${c.id}.objects_total`);
      assert.equal(sc.high_risk_count, c.high_risk_count, `${c.id}.high_risk`);
      assert.equal(
        sc.unresolved_high_risk,
        c.unresolved_high_risk,
        `${c.id}.unresolved_high_risk`,
      );
      assert.deepEqual(sc.by_schema, c.by_schema, `${c.id}.by_schema`);
      assert.deepEqual(sc.by_maturity, c.by_maturity, `${c.id}.by_maturity`);
    }
  },
);

test("the summary carries the numbers this instance is currently blocked on", () => {
  // Committed values, asserted without the workspace — this is what a CI clone
  // actually renders, so it is the assertion that would have caught the original
  // "Sources 0 · Objects 0" regression.
  const s = kbSummary();
  const old = s.containers.find((c) => c.id === "refi-bcn-old-kb");
  assert.equal(s.objects_total, 422);
  assert.equal(s.in_review, 368);
  assert.equal(s.published, 0);
  assert.equal(old.objects_total, 416);
  assert.equal(
    old.high_risk_count,
    157,
    "normalized flag, as the UI facets use",
  );
  assert.equal(old.unresolved_high_risk, 104, "the archive verdict's blocker");
  assert.equal(
    s.containers.filter((c) => c.id !== "unattributed").length,
    6,
    "6 source containers",
  );
  assert.equal(
    s.containers.find((c) => c.id === "unattributed").objects_total,
    0,
    "the canary stays at zero",
  );
});

// ── Row shape: downstream must not be able to tell the paths apart ───────

test("summaryContainers() has the same shape as sourceContainers()", () => {
  const shape = (c) => Object.keys(c).sort().join(",");
  const live = sourceContainers(
    [],
    [{ slug: "x", title: "X", url: "https://example.org/x" }],
  );
  for (const c of summaryContainers()) {
    assert.equal(shape(c), shape(live[0]), `container ${c.id}`);
  }
});

test("summary containers carry NO object bodies", () => {
  for (const c of summaryContainers()) {
    assert.deepEqual(c.objects, [], `${c.id} must hold no bodies`);
    assert.ok(
      Number.isInteger(c.objects_total),
      `${c.id}.objects_total is the count to read instead`,
    );
  }
});

test("archiveReady over a summary container blocks on the carried count", async () => {
  // The vacuity trap, end to end: a container with `objects: []` and a real
  // unresolved count must still fail the high-risk check.
  const { archiveReady } = await import("../src/lib/archive-ready.mjs");
  const c = summaryContainers().find((x) => x.id === "refi-bcn-old-kb");
  const v = archiveReady(
    { ...c, card: { ...c.card, signoff: { date: "2026-08-11", by: "team" } } },
    {
      dispositionFor: () => ({
        applicable: true,
        files_total: 272,
        ingested: 88,
        merged: 9,
        excluded: 175,
        pending: 0,
        discrepancies: [],
      }),
    },
  );
  const hr = v.checks.find((x) => x.id === "high-risk");
  assert.equal(hr.pass, false, "104 unresolved high-risk objects must block");
  assert.match(hr.detail, /104 high-risk objects still at maturity "raw"/);
  assert.equal(v.ready, false);
  assert.equal(v.status, "absorbed");
});

// ── The content boundary ─────────────────────────────────────────────────

test("assertNoObjectLeak catches an object slug in the artifact", () => {
  const objects = [
    {
      schema: "resource",
      slug: "refi-barcelona-gg24-round-proposal",
      title: "t",
    },
  ];
  assert.doesNotThrow(() =>
    assertNoObjectLeak('{"containers":[{"id":"refi-bcn-old-kb"}]}', objects),
  );
  assert.throws(
    () =>
      assertNoObjectLeak(
        '{"sample":"refi-barcelona-gg24-round-proposal"}',
        objects,
      ),
    /object-level content/,
  );
});

test("assertNoObjectLeak does not fire on a slug embedded in a longer word", () => {
  // `resource/celo` is a substring of "Bar·celo·na", which every card mentions.
  // A guard that cries wolf gets suppressed, so this is pinned deliberately.
  assert.doesNotThrow(() =>
    assertNoObjectLeak('{"title":"ReFi Barcelona"}', [
      { schema: "resource", slug: "celo", title: "Celo" },
    ]),
  );
});

test(
  "the committed artifact holds no object slug",
  { skip: noWorkspace },
  () => {
    assertNoObjectLeak(readFileSync(OUT_FILE, "utf8"), loadKb(WORKSPACE_DIR));
  },
);

// ── Refusing to derive from the fallback ─────────────────────────────────

test("deriving from an empty store yields zeros — which is why the CLI refuses", () => {
  // The guard itself lives in the CLI block (it needs resolveKbDir()). What this
  // pins is WHY it has to be there: the derivation is perfectly happy to produce
  // an all-zero summary, and an all-zero summary committed over a good one is
  // the worst outcome available here — /sources would read "nothing ingested",
  // which is the reading that could authorise archiving an unprocessed source.
  const zeroed = deriveKbSummary([]);
  assert.equal(zeroed.objects_total, 0);
  assert.equal(zeroed.containers.length, 1, "only the unattributed canary");
  assert.notDeepEqual(
    zeroed.containers.map((c) => c.id),
    kbSummary().containers.map((c) => c.id),
  );
});

test("a missing summary file throws rather than degrading to zeros", () => {
  assert.throws(
    () => kbSummary("/tmp/definitely-not-a-kb-summary-9d3f.json"),
    /derive:kb-summary/,
  );
});

// ── T1.2: the four rollups — collections, by_domain, maturity, boundary_tiers ──
// collections.mjs's `collectionsViewModel()` THROWS on the summary path until
// this rollup exists (deliberately — see its module header). These tests pin
// the write side: the rollups the read side depends on, present and shaped
// exactly right. Anything that reads the committed file (rather than
// re-deriving from the live store) needs no `noWorkspace` skip.

test("every collection in collections.yaml has a rollup entry in the committed summary", () => {
  const defs = loadCollections();
  const s = kbSummary();
  for (const id of Object.keys(defs)) {
    assert.ok(
      s.collections && s.collections[id],
      `missing collections rollup for "${id}" — re-run \`npm run derive:kb-summary\``,
    );
  }
});

test("a collections rollup entry has exactly the four keys — members_total, not objects_total (TRAP 1)", () => {
  const s = kbSummary();
  assert.ok(s.collections && Object.keys(s.collections).length > 0);
  for (const [id, entry] of Object.entries(s.collections)) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["by_container", "by_schema", "members_total", "publishable_total"],
      id,
    );
  }
});

test("by_domain sums to objects_total, with unset domains bucketed rather than dropped", () => {
  const s = kbSummary();
  assert.ok(s.by_domain);
  const tally = Object.values(s.by_domain).reduce((a, b) => a + b, 0);
  assert.equal(tally, s.objects_total);
});

test("maturity sums to objects_total and always carries raw/reviewed/published", () => {
  const s = kbSummary();
  assert.ok(s.maturity);
  for (const k of ["raw", "reviewed", "published"]) {
    assert.ok(
      Number.isInteger(s.maturity[k]),
      `maturity.${k} must be present even at zero`,
    );
  }
  const tally = Object.values(s.maturity).reduce((a, b) => a + b, 0);
  assert.equal(tally, s.objects_total);
});

test("boundary_tiers sums to the public-use-boundary count in by_schema", () => {
  const s = kbSummary();
  assert.ok(s.boundary_tiers);
  const tally = Object.values(s.boundary_tiers).reduce((a, b) => a + b, 0);
  assert.equal(tally, s.by_schema["public-use-boundary"] ?? 0);
});

test(
  "round trip: the freshly derived summary feeds collectionsViewModel() and agrees with the live path",
  { skip: noWorkspace },
  () => {
    const objects = loadKb(WORKSPACE_DIR);
    const fresh = deriveKbSummary(objects);
    const defs = loadCollections();

    const live = collectionsViewModel({ objects, fromSummary: false, defs });
    let vm;
    assert.doesNotThrow(() => {
      vm = collectionsViewModel({
        objects: [],
        fromSummary: true,
        summary: fresh,
        defs,
      });
    });
    for (const row of live.rows) {
      const summaryRow = vm.rows.find((r) => r.id === row.id);
      assert.equal(
        summaryRow.members_total,
        row.members_total,
        `${row.id}.members_total: summary path and live path must agree`,
      );
      assert.equal(summaryRow.publishable_total, row.publishable_total, row.id);
    }
  },
);
