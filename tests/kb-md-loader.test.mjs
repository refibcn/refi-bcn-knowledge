// The md-store loader: loadKb() reads kb/<schema>/<slug>.md natively — one
// markdown file per object, frontmatter = fields, body = the `notes` field.
// The parse contract is documented in scripts/migrate-kb-to-md.mjs (which
// proved it lossless 422/422 at migration) and kb/README.md:
//
//   1. File starts `---\n`; the closing delimiter is the FIRST `\n---\n`
//      after it. Frontmatter = js-yaml `load` of the text between.
//   2. body = everything after the closing `\n---\n`.
//   3. Strip ONE leading `\n` from body, then ALL trailing whitespace
//      (`.replace(/\s+$/u, "")`).
//   4. entry = { ...frontmatter, ...(body !== "" ? { notes: body } : {}) }.
//   5. Folder = schema, filename = slug. No `schema:`/`id:` keys.
//
// Two test groups: fixtures in a tmp dir pin the parse rules edge by edge
// (independent of the real store), and the real-store group pins the migrated
// corpus — counts per schema, the no-title fallback, notes reattachment over
// every file via an independent re-implementation of the rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { loadKb, resolveKbDir } from "../src/lib/kb.mjs";

// fileURLToPath, not .pathname — the checkout path contains spaces ("03 Libraries").
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const KB_DIR = resolve(REPO_ROOT, "kb");

// The migrated store, proven 422/422 by scripts/migrate-kb-to-md.mjs.
const EXPECTED_COUNTS = {
  "claim-evidence": 34,
  "concept-lineage": 27,
  "encyclopedia-entry": 82,
  "public-use-boundary": 54,
  resource: 133,
  signal: 86,
  "source-system": 6,
};

// ── Fixture helpers ────────────────────────────────────────────────────────

/** A throwaway store: {schema: {slug: fileContent}} → tmp dir path. */
function fixtureStore(spec, rootFiles = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kb-md-"));
  for (const [name, content] of Object.entries(rootFiles)) {
    writeFileSync(join(dir, name), content, "utf8");
  }
  for (const [schema, files] of Object.entries(spec)) {
    mkdirSync(join(dir, schema));
    for (const [file, content] of Object.entries(files)) {
      writeFileSync(join(dir, schema, file), content, "utf8");
    }
  }
  return dir;
}

const md = (fields, body) =>
  `---\n${yaml.dump(fields, { lineWidth: -1 })}---\n` +
  (body === undefined ? "" : `\n${body}\n`);

// ── The parse rules, edge by edge ──────────────────────────────────────────

test("md loader: schema from folder, slug from filename, id joins them", () => {
  const dir = fixtureStore({
    resource: { "some-thing.md": md({ title: "Some Thing" }) },
  });
  const [o] = loadKb(dir);
  assert.equal(o.schema, "resource");
  assert.equal(o.slug, "some-thing");
  assert.equal(o.id, "resource/some-thing");
  assert.equal(o.title, "Some Thing");
});

test("md loader: normalized shape carries the same keys loadKb always produced", () => {
  const dir = fixtureStore({
    signal: {
      "s.md": md({
        title: "S",
        signal_type: "status-unknown",
        domain: "funding",
        maturity: "raw",
        interpretation: "Timeline elapsed.",
      }),
    },
  });
  const [o] = loadKb(dir);
  assert.deepEqual(Object.keys(o).sort(), [
    "domain",
    "high_risk",
    "id",
    "maturity",
    "origin",
    "raw",
    "schema",
    "slug",
    "subtype",
    "summary",
    "title",
  ]);
  assert.equal(o.subtype, "status-unknown");
  assert.equal(o.summary, "Timeline elapsed.");
});

test("md loader: body becomes raw.notes; the entry is frontmatter + notes and nothing else", () => {
  const dir = fixtureStore({
    resource: {
      "with-notes.md": md({ title: "N", maturity: "raw" }, "The body text."),
    },
  });
  const [o] = loadKb(dir);
  assert.deepEqual(o.raw, {
    title: "N",
    maturity: "raw",
    notes: "The body text.",
  });
});

test("md loader: an object without a body has NO raw.notes key (absent, not empty)", () => {
  const dir = fixtureStore({
    resource: { "bare.md": md({ title: "B" }) },
  });
  const [o] = loadKb(dir);
  assert.equal("notes" in o.raw, false);
});

test("md loader: a whitespace-only body strips to nothing — still no notes key", () => {
  const dir = fixtureStore({
    resource: { "ws.md": "---\ntitle: W\n---\n\n \n\t\n" },
  });
  const [o] = loadKb(dir);
  assert.equal("notes" in o.raw, false);
});

test("md loader: ONE leading newline is stripped, not two", () => {
  // After the closing `\n---\n` the writer emits `\n<notes>\n`; a notes value
  // that itself STARTS with a blank line must keep it. Written raw so the
  // fixture cannot be normalized by the md() helper.
  const dir = fixtureStore({
    resource: { "lead.md": "---\ntitle: L\n---\n\n\nStarts after a blank.\n" },
  });
  const [o] = loadKb(dir);
  assert.equal(o.raw.notes, "\nStarts after a blank.");
});

test("md loader: ALL trailing whitespace is stripped from the body", () => {
  const dir = fixtureStore({
    resource: { "trail.md": "---\ntitle: T\n---\n\nBody.\n\n \n" },
  });
  const [o] = loadKb(dir);
  assert.equal(o.raw.notes, "Body.");
});

test("md loader: the FIRST `\\n---\\n` closes the frontmatter — a later --- line is body", () => {
  const dir = fixtureStore({
    resource: {
      "hr.md":
        "---\ntitle: H\n---\n\nAbove the rule.\n\n---\n\nBelow the rule.\n",
    },
  });
  const [o] = loadKb(dir);
  assert.equal(o.raw.notes, "Above the rule.\n\n---\n\nBelow the rule.");
  assert.equal(o.title, "H", "frontmatter must not swallow the body");
});

test("md loader: a file without the opening delimiter fails loud, naming the file", () => {
  const dir = fixtureStore({
    resource: { "broken.md": "title: no delimiters\n" },
  });
  assert.throws(() => loadKb(dir), /resource[/\\]broken\.md/);
});

test("md loader: a file without a closing delimiter fails loud, naming the file", () => {
  const dir = fixtureStore({
    resource: { "open.md": "---\ntitle: never closed\n" },
  });
  assert.throws(() => loadKb(dir), /resource[/\\]open\.md/);
});

test("md loader: title falls back to slug when frontmatter has none", () => {
  const dir = fixtureStore({
    "public-use-boundary": { "untitled-boundary.md": md({ tier: "public" }) },
  });
  const [o] = loadKb(dir);
  assert.equal(o.title, "untitled-boundary");
});

test("md loader: maturity defaults — boundary for public-use-boundary, raw otherwise", () => {
  const dir = fixtureStore({
    "public-use-boundary": { "b.md": md({ tier: "internal-only" }) },
    resource: { "r.md": md({ title: "R" }) },
  });
  const objects = loadKb(dir);
  assert.equal(
    objects.find((o) => o.schema === "public-use-boundary").maturity,
    "boundary",
  );
  assert.equal(objects.find((o) => o.schema === "resource").maturity, "raw");
});

test("md loader: raw.tier is reachable and feeds subtype + high_risk on boundary objects", () => {
  // boundaryTiers (slices.mjs) reads o.raw.tier; the normalized subtype chain
  // ends on o.tier; `public-with-caveat` sets the normalized high_risk flag.
  const dir = fixtureStore({
    "public-use-boundary": {
      "caveat.md": md({ title: "C", tier: "public-with-caveat" }),
    },
  });
  const [o] = loadKb(dir);
  assert.equal(o.raw.tier, "public-with-caveat");
  assert.equal(o.subtype, "public-with-caveat");
  assert.equal(o.high_risk, true);
});

test("md loader: README.md inside a schema dir and non-directories at the root are ignored", () => {
  const dir = fixtureStore(
    {
      resource: {
        "real.md": md({ title: "R" }),
        "README.md": "# not an object\n",
      },
    },
    { "README.md": "# store readme\n", "all-objects.base": "views: []\n" },
  );
  const objects = loadKb(dir);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].id, "resource/real");
});

test("md loader: non-md files inside a schema dir are ignored", () => {
  const dir = fixtureStore({
    resource: { "real.md": md({ title: "R" }), "notes.txt": "not md\n" },
  });
  assert.equal(loadKb(dir).length, 1);
});

// ── The seam ───────────────────────────────────────────────────────────────

test("resolveKbDir() defaults to the in-repo kb/ store", () => {
  assert.equal(resolveKbDir(), KB_DIR);
});

test("KB_DIR env override still wins", () => {
  process.env.KB_DIR = "/tmp/kb-md-override";
  try {
    assert.equal(resolveKbDir(), "/tmp/kb-md-override");
  } finally {
    delete process.env.KB_DIR;
  }
});

// ── The real store — always present now; nothing here may skip ─────────────

test("real store: 422 objects, per-schema counts match the migrated corpus", () => {
  const objects = loadKb();
  assert.equal(objects.length, 422);
  const bySchema = {};
  for (const o of objects) bySchema[o.schema] = (bySchema[o.schema] ?? 0) + 1;
  assert.deepEqual(bySchema, EXPECTED_COUNTS);
});

test("real store: every object is well-shaped and id = schema/slug", () => {
  for (const o of loadKb()) {
    assert.equal(o.id, `${o.schema}/${o.slug}`);
    assert.ok(
      EXPECTED_COUNTS[o.schema] !== undefined,
      `unknown schema ${o.schema}`,
    );
    assert.ok(o.title, o.id);
    assert.equal(typeof o.subtype, "string");
    assert.equal(typeof o.domain, "string");
    assert.equal(typeof o.maturity, "string");
    assert.equal(typeof o.high_risk, "boolean");
    assert.ok(o.raw && typeof o.raw === "object");
    assert.equal("schema" in o.raw, false, "no schema key in frontmatter");
    assert.equal("id" in o.raw, false, "no id key in frontmatter");
  }
});

test("real store: exactly 33 objects have no frontmatter title, and each falls back to its slug", () => {
  const untitled = loadKb().filter((o) => !o.raw.title);
  assert.equal(untitled.length, 33);
  for (const o of untitled) assert.equal(o.title, o.slug);
});

test("real store: raw.tier is reachable on all 54 public-use-boundary objects", () => {
  const boundaries = loadKb().filter((o) => o.schema === "public-use-boundary");
  assert.equal(boundaries.length, 54);
  for (const b of boundaries) {
    assert.equal(typeof b.raw.tier, "string", b.id);
    assert.ok(b.raw.tier.length > 0, b.id);
  }
});

test("real store: notes reattach per the documented rule on every file (338 carry notes)", () => {
  // Independent re-implementation of the parse rule, checked file by file
  // against what loadKb() returned — the loader cannot drift from the
  // documented contract without this going red.
  const byId = new Map(loadKb().map((o) => [o.id, o]));
  let withNotes = 0;
  for (const schema of Object.keys(EXPECTED_COUNTS)) {
    for (const f of readdirSync(join(KB_DIR, schema))) {
      if (!f.endsWith(".md") || f === "README.md") continue;
      const content = readFileSync(join(KB_DIR, schema, f), "utf8");
      assert.ok(
        content.startsWith("---\n"),
        `${schema}/${f}: opening delimiter`,
      );
      const close = content.indexOf("\n---\n", 3);
      assert.notEqual(close, -1, `${schema}/${f}: closing delimiter`);
      const frontmatter = yaml.load(content.slice(4, close + 1)) ?? {};
      let body = content.slice(close + 5);
      if (body.startsWith("\n")) body = body.slice(1);
      body = body.replace(/\s+$/u, "");
      const expected = {
        ...frontmatter,
        ...(body !== "" ? { notes: body } : {}),
      };
      const o = byId.get(`${schema}/${f.replace(/\.md$/, "")}`);
      assert.ok(o, `${schema}/${f} missing from loadKb()`);
      assert.deepEqual(o.raw, expected, `${schema}/${f}`);
      if (body !== "") withNotes++;
    }
  }
  assert.equal(
    withNotes,
    338,
    "the migration reported 338 notes-carrying objects",
  );
});
