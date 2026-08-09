// Source containers: grouping every KB object under the source system it came
// from, plus the per-container ingest disposition read from the batch rosters.
//
// This is the seam under /sources (C2) and the archive-ready verdict (C3) — the
// evidence that authorises archiving a superseded upstream repo read-only. So
// the tests here pin the two failure modes that would be silently wrong rather
// than loud: an object attributed to the WRONG container (nested prefixes) and
// an object attributed to NO container (dropped instead of surfaced).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { loadKb, sourceContainers, disposition } from "../src/lib/kb.mjs";
import {
  deriveDisposition,
  deriveDispositions,
} from "../scripts/derive-disposition.mjs";

// fileURLToPath, not .pathname — the checkout path contains spaces ("03 Libraries").
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const WORKSPACE_KB = join(REPO_ROOT, "..", "..", "data", "kb");
const WORKSPACE_BATCHES = join(REPO_ROOT, "..", "..", "docs", "kms", "batches");
const noWorkspace = !existsSync(join(WORKSPACE_KB, "index.json"));
const noBatches = !existsSync(WORKSPACE_BATCHES);

// The plan's fixture helper, verbatim: origin lands at BOTH `o.origin` (the
// loadKb-normalized field) and `o.raw.provenance.origin` (the store shape).
const o = (schema, slug, origin, extra = {}) => ({
  id: `${schema}/${slug}`,
  schema,
  slug,
  title: slug,
  subtype: "",
  domain: "",
  maturity: "raw",
  high_risk: false,
  summary: "",
  origin,
  raw: { provenance: { origin }, ...extra },
});

const byId = (containers, id) => containers.find((x) => x.id === id);

// ── Grouping ─────────────────────────────────────────────────────────────

test("objects group under their source-system card by provenance origin prefix", () => {
  const objects = [
    o("source-system", "refi-bcn-old-kb", "", { raw: {} }),
    o("resource", "coop57", "repos/ReFi-Barcelona/content/x.md"),
  ];
  const cards = [
    { slug: "refi-bcn-old-kb", origin_prefixes: ["repos/ReFi-Barcelona/"] },
  ];
  const c = sourceContainers(objects, cards);
  assert.equal(byId(c, "refi-bcn-old-kb").objects.length, 1);
});

test("objects matching no card land in an 'unattributed' container, never dropped", () => {
  const c = sourceContainers([o("signal", "s1", "somewhere/else.md")], []);
  assert.equal(byId(c, "unattributed").objects.length, 1);
});

test("source-system objects are cards, not contents — excluded from every container", () => {
  const objects = [
    o("source-system", "refi-bcn-old-kb", "", {
      url: "https://github.com/refibcn/ReFi-Barcelona",
    }),
    o("resource", "a", "repos/ReFi-Barcelona/content/a.md"),
  ];
  const c = sourceContainers(objects);
  const old = byId(c, "refi-bcn-old-kb");
  assert.equal(old.objects.length, 1, "only the resource is content");
  assert.equal(old.objects[0].slug, "a");
  assert.equal(old.by_schema["source-system"], undefined, "card never tallied");
  assert.equal(
    byId(c, "unattributed").objects.length,
    0,
    "the card is not unattributed either — it is simply not content",
  );
});

// ── Longest-prefix-wins ──────────────────────────────────────────────────
// Two REAL cards nest: refi-bcn-os-operations sits inside refi-bcn. Naive
// first-match would swallow every operations object into refi-bcn.

const REAL_REFI_BCN_URL = "https://github.com/refibcn/refi-bcn-os";
const REAL_OPS_URL =
  "https://github.com/refibcn/refi-bcn-os/tree/main/packages/operations";
const OPS_OBJECT_ORIGIN = `${REAL_OPS_URL}/meetings/2026-07-15-ops-sync.md`;

test("longest-prefix-wins with explicit origin_prefixes (nested real cards)", () => {
  // Exactly the prefixes the real source-system.yaml declares today.
  const cards = [
    {
      slug: "refi-bcn",
      origin_prefixes: [
        "https://github.com/refibcn/refi-bcn-os/",
        "repos/refi-bcn-os/",
      ],
    },
    {
      slug: "refi-bcn-os-operations",
      origin_prefixes: [
        "https://github.com/refibcn/refi-bcn-os/tree/main/packages/operations/",
        "https://github.com/refibcn/refi-bcn-os/blob/main/packages/operations/",
        "packages/operations/",
      ],
    },
  ];
  const objects = [
    o("signal", "ops", OPS_OBJECT_ORIGIN),
    o("resource", "root", "https://github.com/refibcn/refi-bcn-os/README.md"),
  ];
  const c = sourceContainers(objects, cards);
  assert.deepEqual(
    byId(c, "refi-bcn-os-operations").objects.map((x) => x.slug),
    ["ops"],
    "the operations object must NOT be swallowed by the parent repo card",
  );
  assert.deepEqual(
    byId(c, "refi-bcn").objects.map((x) => x.slug),
    ["root"],
  );
});

test("longest-prefix-wins when prefixes are derived from url (no origin_prefixes)", () => {
  // The forward/backward-compatible path: a card that has never had the
  // origin_prefixes field added still groups correctly, and still respects
  // nesting, because derivation keeps the full url path.
  const cards = [
    { slug: "refi-bcn", url: REAL_REFI_BCN_URL },
    { slug: "refi-bcn-os-operations", url: REAL_OPS_URL },
  ];
  const c = sourceContainers([o("signal", "ops", OPS_OBJECT_ORIGIN)], cards);
  assert.deepEqual(
    byId(c, "refi-bcn-os-operations").objects.map((x) => x.slug),
    ["ops"],
  );
  assert.equal(byId(c, "refi-bcn").objects.length, 0);
});

test("url derivation covers both notations: the url itself and repos/<repo>/", () => {
  const cards = [
    {
      slug: "refi-bcn-old-kb",
      url: "https://github.com/refibcn/ReFi-Barcelona",
    },
  ];
  const objects = [
    // The two shapes the real store actually records (362 + 54 objects).
    o(
      "resource",
      "blob",
      "https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/a.md",
    ),
    o("resource", "workcopy", "repos/ReFi-Barcelona/content/b.md"),
  ];
  const c = sourceContainers(objects, cards);
  assert.equal(byId(c, "refi-bcn-old-kb").objects.length, 2);
  assert.equal(byId(c, "unattributed").objects.length, 0);
});

test("a derived prefix keeps its trailing slash — no sibling-repo bleed", () => {
  const cards = [
    {
      slug: "refi-bcn-old-kb",
      url: "https://github.com/refibcn/ReFi-Barcelona",
    },
  ];
  const c = sourceContainers(
    [o("resource", "sibling", "repos/ReFi-Barcelona-archive/content/a.md")],
    cards,
  );
  assert.equal(byId(c, "refi-bcn-old-kb").objects.length, 0);
  assert.equal(byId(c, "unattributed").objects.length, 1);
});

test("explicit origin_prefixes take over from the url entirely", () => {
  // refibcn-site is the real case: the GitHub repo is `refibcn.github.io` but
  // the local working copy is `repos/refibcn-site/`. Derivation cannot know
  // that; the explicit list is authoritative when present.
  const cards = [
    {
      slug: "refibcn-site",
      url: "https://github.com/refibcn/refibcn.github.io",
      origin_prefixes: ["repos/refibcn-site/"],
    },
  ];
  const c = sourceContainers(
    [
      o("resource", "site", "repos/refibcn-site/src/pages/index.astro"),
      o(
        "resource",
        "gh",
        "https://github.com/refibcn/refibcn.github.io/README.md",
      ),
    ],
    cards,
  );
  assert.deepEqual(
    byId(c, "refibcn-site").objects.map((x) => x.slug),
    ["site"],
    "only the explicit prefix matches; the url is not implicitly added",
  );
  assert.equal(byId(c, "unattributed").objects.length, 1);
});

test("a card with neither origin_prefixes nor url is an empty container, not an error", () => {
  const c = sourceContainers([o("signal", "s", "x/y.md")], [{ slug: "ghost" }]);
  assert.equal(byId(c, "ghost").objects.length, 0);
  assert.equal(byId(c, "unattributed").objects.length, 1);
});

// ── Match key ────────────────────────────────────────────────────────────

test("match key falls back to source_lineage when there is no provenance object", () => {
  // 54 real objects (all public-use-boundary) are recorded this way — they have
  // NO provenance object at all. Missing this shape silently inflates
  // 'unattributed', which is the canary for the whole seam.
  const lineageOnly = {
    id: "public-use-boundary/b1",
    schema: "public-use-boundary",
    slug: "b1",
    title: "b1",
    subtype: "",
    domain: "",
    maturity: "boundary",
    high_risk: false,
    summary: "",
    // Deliberately blank, so the match can ONLY come from raw.source_lineage.
    origin: "",
    raw: { source_lineage: "repos/ReFi-Barcelona/content/c.md" },
  };
  const c = sourceContainers(
    [lineageOnly],
    [{ slug: "refi-bcn-old-kb", origin_prefixes: ["repos/ReFi-Barcelona/"] }],
  );
  assert.equal(byId(c, "refi-bcn-old-kb").objects.length, 1);
  assert.equal(byId(c, "unattributed").objects.length, 0);
});

test("provenance.origin wins over source_lineage when both are present", () => {
  const both = {
    ...o("resource", "x", "repos/ReFi-Barcelona/content/a.md"),
    raw: {
      provenance: { origin: "repos/ReFi-Barcelona/content/a.md" },
      source_lineage: "repos/Regenerant-Catalunya/content/b.md",
    },
  };
  const c = sourceContainers(
    [both],
    [
      { slug: "refi-bcn-old-kb", origin_prefixes: ["repos/ReFi-Barcelona/"] },
      { slug: "regenerant", origin_prefixes: ["repos/Regenerant-Catalunya/"] },
    ],
  );
  assert.equal(byId(c, "refi-bcn-old-kb").objects.length, 1);
  assert.equal(byId(c, "regenerant").objects.length, 0);
});

// ── Tallies + shape ──────────────────────────────────────────────────────

test("container shape: by_maturity, by_schema, high_risk_count, card, title", () => {
  const cards = [
    { slug: "src", title: "A Source", origin_prefixes: ["repos/S/"] },
  ];
  const objects = [
    { ...o("resource", "r1", "repos/S/a.md"), high_risk: true },
    { ...o("signal", "s1", "repos/S/b.md"), maturity: "reviewed" },
    { ...o("signal", "s2", "repos/S/c.md"), maturity: "" },
  ];
  const c = sourceContainers(objects, cards);
  const src = byId(c, "src");
  assert.equal(src.title, "A Source");
  assert.equal(src.card, cards[0], "the card is carried through by reference");
  assert.equal(src.high_risk_count, 1);
  assert.deepEqual(src.by_schema, { resource: 1, signal: 2 });
  // An unset maturity gets an explicit bucket key — never the string
  // "undefined" and never a hole in the object.
  assert.deepEqual(src.by_maturity, { raw: 1, reviewed: 1, unset: 1 });
  assert.equal(byId(c, "unattributed").card, null);
  assert.equal(byId(c, "unattributed").title, "Unattributed");
});

test("tallies never lose a bucket to an Object.prototype key", () => {
  const c = sourceContainers(
    [
      { ...o("__proto__", "p", "repos/S/a.md"), maturity: "toString" },
      { ...o("constructor", "q", "repos/S/b.md"), maturity: "toString" },
    ],
    [{ slug: "src", origin_prefixes: ["repos/S/"] }],
  );
  const src = byId(c, "src");
  // Compared as entries, not against an object literal: writing
  // `{ __proto__: 1 }` in the expectation would set the prototype instead of
  // an own key — the very hole this guards.
  assert.deepEqual(Object.entries(src.by_schema), [
    ["__proto__", 1],
    ["constructor", 1],
  ]);
  assert.deepEqual(Object.entries(src.by_maturity), [["toString", 2]]);
});

test("containers are deterministically ordered: most objects first, id asc, unattributed last", () => {
  const cards = [
    { slug: "zebra", origin_prefixes: ["repos/Z/"] },
    { slug: "alpha", origin_prefixes: ["repos/A/"] },
    { slug: "big", origin_prefixes: ["repos/B/"] },
  ];
  const objects = [
    o("resource", "b1", "repos/B/1.md"),
    o("resource", "b2", "repos/B/2.md"),
    o("resource", "orphan", "nowhere/1.md"),
  ];
  const c = sourceContainers(objects, cards);
  assert.deepEqual(
    c.map((x) => x.id),
    ["big", "alpha", "zebra", "unattributed"],
  );
  // Same input, shuffled card order → same output order.
  const shuffled = sourceContainers(objects, [cards[1], cards[2], cards[0]]);
  assert.deepEqual(
    shuffled.map((x) => x.id),
    ["big", "alpha", "zebra", "unattributed"],
  );
});

test("unattributed is always present, even when empty — it is the canary", () => {
  const c = sourceContainers([], []);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0], {
    id: "unattributed",
    title: "Unattributed",
    card: null,
    objects: [],
    by_maturity: {},
    by_schema: {},
    high_risk_count: 0,
  });
});

test("cards default to the source-system objects in the set", () => {
  const objects = [
    o("source-system", "refi-bcn-old-kb", "", {
      url: "https://github.com/refibcn/ReFi-Barcelona",
      title: "Old KB",
    }),
    o("resource", "a", "repos/ReFi-Barcelona/content/a.md"),
  ];
  const c = sourceContainers(objects);
  assert.deepEqual(
    c.map((x) => x.id),
    ["refi-bcn-old-kb", "unattributed"],
  );
  assert.equal(byId(c, "refi-bcn-old-kb").objects.length, 1);
});

// ── Real store ───────────────────────────────────────────────────────────

test(
  "real store: every object is attributed, unattributed is zero",
  { skip: noWorkspace },
  () => {
    const objects = loadKb("../../data/kb/");
    assert.equal(objects.length, 422, "416 content objects + 6 source cards");
    const c = sourceContainers(objects);

    assert.deepEqual(
      c.map((x) => x.id),
      [
        "refi-bcn-old-kb",
        "notion-refi-bcn",
        "refi-bcn",
        "refi-bcn-os-operations",
        "refibcn-site",
        "regenerant-catalunya-repo",
        "unattributed",
      ],
      "6 cards + unattributed last; ties broken by id",
    );

    assert.equal(byId(c, "refi-bcn-old-kb").objects.length, 416);
    // THE CANARY. If this ever goes non-zero, grouping has silently lost
    // objects that a container page would otherwise never show.
    assert.equal(byId(c, "unattributed").objects.length, 0);
    // Batch 2/3 are not ingested yet — these exist but are legitimately empty.
    for (const id of [
      "refi-bcn",
      "notion-refi-bcn",
      "regenerant-catalunya-repo",
      "refi-bcn-os-operations",
      "refibcn-site",
    ]) {
      assert.equal(byId(c, id).objects.length, 0, id);
    }

    // No object is counted twice, and none is dropped.
    const total = c.reduce((a, x) => a + x.objects.length, 0);
    assert.equal(total, 416);
    assert.equal(
      new Set(c.flatMap((x) => x.objects.map((y) => y.id))).size,
      416,
    );
  },
);

test("real store: per-container tallies", { skip: noWorkspace }, () => {
  const objects = loadKb("../../data/kb/");
  const old = byId(sourceContainers(objects), "refi-bcn-old-kb");

  assert.deepEqual(old.by_schema, {
    "claim-evidence": 34,
    "concept-lineage": 27,
    "encyclopedia-entry": 82,
    "public-use-boundary": 54,
    resource: 133,
    signal: 86,
  });
  assert.equal(
    Object.values(old.by_schema).reduce((a, b) => a + b, 0),
    416,
    "source-system (6) is excluded from the tally",
  );

  // loadKb DEFAULTS maturity: unset + public-use-boundary => "boundary",
  // unset otherwise => "raw". So nothing reaches here with an unset maturity
  // even though 54 store entries have no `maturity:` key of their own.
  assert.deepEqual(old.by_maturity, { boundary: 54, raw: 362 });
  assert.equal(
    objects.filter((x) => x.schema !== "source-system" && !x.raw.maturity)
      .length,
    54,
    "the 54 with no maturity in the store are exactly the boundary objects",
  );

  // high_risk_count uses the loadKb-normalized flag, so it agrees with
  // facets().highRisk that the UI already renders. That is broader than the
  // store's own `high_risk: true` flag, which is on 104 objects — the extra
  // 53 are public-use-boundary records whose tier is `public-with-caveat`.
  assert.equal(old.high_risk_count, 157);
  assert.equal(
    objects.filter((x) => x.raw.high_risk === true).length,
    104,
    "raw store flag, for the record",
  );
});

// ── Disposition ──────────────────────────────────────────────────────────

test("disposition() returns null for a container with no batch", () => {
  assert.equal(disposition("notion-refi-bcn"), null);
  assert.equal(disposition("no-such-container"), null);
  // Object.prototype keys must be null too, not inherited members.
  for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.equal(disposition(id), null, id);
  }
});

test("disposition() null is distinguishable from a zero-file batch", () => {
  const d = disposition("refi-bcn-old-kb");
  assert.notEqual(d, null);
  assert.equal(typeof d.files_total, "number");
});

test("committed disposition: batch-1 arithmetic closes exactly", () => {
  const d = disposition("refi-bcn-old-kb");
  assert.equal(d.batch, "batch-1");
  assert.equal(d.status, "ingested");
  assert.equal(d.ingested, 88, "86 from content/ + 2 from _archive/");
  assert.equal(d.merged, 9);
  assert.equal(d.excluded, 175, "12 content stubs + 160 bulk + 3 post-hoc");
  assert.equal(d.files_total, 272);
  assert.equal(d.pending, 0);
  assert.equal(d.ingested + d.merged + d.excluded, d.files_total);

  // The independent file-side cross-check, measured against the canonical
  // Batch-1 checkout repos/ReFi-Barcelona @ fe87706 (272 tracked .md):
  //   164 content/ + 76 docs/ + 30 _archive/ + 2 repo-root = 272.
  // The roster's own `coverage` block sums to 269 — it counted _archive/Dev_old
  // (29) but not its sibling _archive/themes-backup (1), and never walked the
  // repo root (2). Those 3 files are recorded in the roster's
  // `post_hoc_dispositions` block and MUST land in the totals; a disposition
  // that reports "0 pending" over a corpus it only partly counted is exactly
  // the wrong archive-ready verdict this seam exists to prevent.
  assert.equal(164 + 76 + 30 + 2, d.files_total);
  const postHoc = d.excluded_reasons.filter((r) => r.file);
  assert.equal(postHoc.length, 3);
  assert.deepEqual(postHoc.map((r) => r.file).sort(), [
    "repos/ReFi-Barcelona/AGENTS.md",
    "repos/ReFi-Barcelona/README.md",
    "repos/ReFi-Barcelona/_archive/themes-backup/README-Minimal-Refi-Theme.md",
  ]);
  assert.equal(
    d.excluded_reasons.reduce((a, r) => a + r.files, 0),
    d.excluded,
    "the reasons account for every excluded file",
  );

  // work_orders_prepared (93) is NOT the file count (88) — several files
  // produced more than one work order. Never conflate them.
  assert.equal(d.work_orders_prepared, 93);
  assert.notEqual(d.work_orders_prepared, d.ingested);
});

test("post-hoc dispositions are counted, and unknown classes refuse to derive", () => {
  const base = {
    batch: "batch-p",
    status: "ingested",
    source_card: "s",
    coverage: {
      content_md: 4,
      includes_from_content: 4,
      includes_from_archive: 0,
      total_work_order_sources: 4,
      excluded_content_nonstub_stub: 0,
      merges: 0,
      bulk_excluded: {},
      work_orders_prepared: 4,
    },
    merges: [],
    excluded_stubs: [],
    work_orders: [1, 2, 3, 4],
  };
  assert.equal(deriveDisposition(base).files_total, 4);

  const withPostHoc = {
    ...base,
    post_hoc_dispositions: {
      recorded: "2026-08-09",
      reason: "gap closed by measurement",
      excluded: [{ file: "repos/X/README.md", reason: "scaffolding" }],
    },
  };
  const d = deriveDisposition(withPostHoc);
  assert.equal(d.excluded, 1);
  assert.equal(d.files_total, 5, "post-hoc files join the corpus total");
  assert.equal(d.pending, 0);
  assert.deepEqual(d.excluded_reasons, [
    {
      reason: "post-hoc (missed by triage): repos/X/README.md",
      files: 1,
      file: "repos/X/README.md",
    },
  ]);

  // A class we do not know how to count must stop the derivation, not vanish.
  assert.throws(
    () =>
      deriveDisposition({
        ...base,
        post_hoc_dispositions: { ingested: [{ file: "repos/X/late.md" }] },
      }),
    /unhandled post_hoc_dispositions key\(s\) ingested/,
  );
  assert.throws(
    () =>
      deriveDisposition({
        ...base,
        post_hoc_dispositions: { excluded: [{ reason: "no file field" }] },
      }),
    /needs a `file:`/,
  );
});

test("deriveDisposition throws when the accounting does not close", () => {
  const good = {
    batch: "batch-x",
    status: "ingested",
    source_card: "s",
    coverage: {
      content_md: 10,
      includes_from_content: 4,
      includes_from_archive: 1,
      total_work_order_sources: 5,
      excluded_content_nonstub_stub: 2,
      merges: 1,
      bulk_excluded: { junk: 3 },
      work_orders_prepared: 6,
    },
    merges: [1],
    excluded_stubs: [1, 2],
    work_orders: [1, 2, 3, 4, 5, 6],
  };
  assert.equal(deriveDisposition(good).files_total, 11); // 5 + 1 + 5
  assert.equal(deriveDisposition(good).pending, 0);

  const bend = (path, value) => {
    const c = structuredClone(good);
    let node = c;
    const keys = path.split(".");
    for (const k of keys.slice(0, -1)) node = node[k];
    node[keys.at(-1)] = value;
    return c;
  };
  const cases = [
    ["coverage.total_work_order_sources", 99, /total_work_order_sources/],
    ["coverage.merges", 99, /merges/],
    ["coverage.excluded_content_nonstub_stub", 99, /excluded_stubs/],
    ["coverage.work_orders_prepared", 99, /work_orders/],
    // 4 ingested + 1 merge + 2 stubs = 7 cannot come out of a 5-file content
    // tree — the content side over-accounts.
    ["coverage.content_md", 5, /content_md/],
    ["coverage.content_md", "many", /content_md/],
  ];
  for (const [path, value, re] of cases) {
    assert.throws(() => deriveDisposition(bend(path, value)), re, path);
  }
});

test("deriveDispositions skips non-batch yaml and keys on source_card", () => {
  const dir = mkdtempSync(join(tmpdir(), "kb-batches-"));
  writeFileSync(
    join(dir, "batch-9.yaml"),
    yaml.dump({
      batch: "batch-9",
      status: "prepared",
      source_card: "some-card",
      coverage: {
        content_md: 3,
        includes_from_content: 3,
        includes_from_archive: 0,
        total_work_order_sources: 3,
        excluded_content_nonstub_stub: 0,
        merges: 0,
        bulk_excluded: {},
        work_orders_prepared: 3,
      },
      merges: [],
      excluded_stubs: [],
      work_orders: [1, 2, 3],
    }),
    "utf8",
  );
  // No source_card / no coverage → not a batch roster, must be ignored.
  writeFileSync(join(dir, "notes.yaml"), yaml.dump({ hello: "world" }), "utf8");
  const out = deriveDispositions(dir);
  assert.deepEqual(Object.keys(out.sources), ["some-card"]);
  assert.equal(out.sources["some-card"].files_total, 3);
  assert.equal(out.sources["some-card"].status, "prepared");
});

test(
  "committed sources-disposition.json is not stale vs the workspace batch rosters",
  { skip: noBatches },
  () => {
    const fresh = deriveDispositions(WORKSPACE_BATCHES);
    for (const [card, rec] of Object.entries(fresh.sources)) {
      assert.deepEqual(
        disposition(card),
        rec,
        `${card}: run \`npm run derive:disposition\` and commit the result`,
      );
    }
  },
);
