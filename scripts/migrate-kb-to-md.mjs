#!/usr/bin/env node
/**
 * migrate-kb-to-md.mjs — migrate the typed KB store from the parent repo's
 * YAML registries (refi-bcn-os/data/kb/*.yaml, shape `entries: {slug: fields}`)
 * to one markdown file per object in THIS repo: kb/<schema>/<slug>.md.
 *
 * File format:
 *   ---
 *   <yaml frontmatter: the entire entry object minus the `notes` key>
 *   ---
 *
 *   <notes verbatim, if present>
 *
 * Nothing is invented: no `schema:`, no `id:`, no timestamps. The folder
 * carries the schema; the filename carries the slug.
 *
 * Body reattachment rule (a loader MUST mirror this exactly):
 *   body  = everything after the closing `---\n` delimiter
 *   notes = body with ONE leading `\n` stripped, then ALL trailing
 *           whitespace stripped (`.replace(/\s+$/u, '')`)
 *   entry = { ...frontmatter, ...(notes !== '' ? { notes } : {}) }
 * To make that rule lossless, `notes` values are normalized AT CONVERSION with
 * the same trailing-whitespace strip; every normalization is counted and
 * reported. (At migration time exactly 1 of 338 notes carried a trailing
 * newline; no other whitespace anomalies existed.)
 *
 * Fidelity proof: after writing, every md file is re-read from disk, parsed,
 * reconstructed per the rule above, and assert.deepStrictEqual'd against the
 * (normalized) source entry. Any mismatch prints schema/slug + diff, exit 1.
 *
 * Idempotent: recreates the kb/<schema>/ directories on each run. It only
 * ever deletes subdirectories of kb/ (the store it owns); root-level files
 * (*.base views, README.md) are preserved. Guard: refuses to run if kb/
 * contains anything that is not .md/.base/README.md.
 */

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(repoRoot, "..", "..", "data", "kb");
const targetDir = join(repoRoot, "kb");

const EXPECTED_COUNTS = {
  "claim-evidence": 34,
  "concept-lineage": 27,
  "encyclopedia-entry": 82,
  "public-use-boundary": 54,
  resource: 133,
  signal: 86,
  "source-system": 6,
};

const SLUG_RE = /^[a-z0-9][a-z0-9\-_.]*$/;

/** Canonical notes normalization — mirrored by the reattachment rule. */
const normalizeNotes = (s) => s.replace(/\s+$/u, "");

function fail(msg) {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Load the source store
// ---------------------------------------------------------------------------
if (!existsSync(sourceDir)) fail(`source dir not found: ${sourceDir}`);

const store = new Map(); // schema -> Map(slug -> entry)
const yamlFiles = readdirSync(sourceDir)
  .filter((f) => f.endsWith(".yaml"))
  .sort();
for (const file of yamlFiles) {
  const schema = file.replace(/\.yaml$/, "");
  const doc = yaml.load(readFileSync(join(sourceDir, file), "utf8"));
  if (!doc || typeof doc.entries !== "object" || doc.entries === null) {
    fail(`${file}: expected shape { entries: { <slug>: <fields> } }`);
  }
  const entries = new Map();
  for (const [slug, entry] of Object.entries(doc.entries)) {
    if (!SLUG_RE.test(slug))
      fail(`${schema}/${slug}: slug is not filename-safe`);
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`${schema}/${slug}: entry is not a mapping`);
    }
    if ("notes" in entry && typeof entry.notes !== "string") {
      fail(`${schema}/${slug}: notes is not a string`);
    }
    if ("body" in entry || "content" in entry) {
      fail(`${schema}/${slug}: unexpected body/content field`);
    }
    entries.set(slug, entry);
  }
  store.set(schema, entries);
}

// ---------------------------------------------------------------------------
// 2. Guard + clean the target
// ---------------------------------------------------------------------------
if (existsSync(targetDir)) {
  const offenders = [];
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (!p.endsWith(".md") && !p.endsWith(".base")) {
        offenders.push(relative(repoRoot, p));
      }
    }
  };
  walk(targetDir);
  if (offenders.length > 0) {
    fail(
      `refusing to run — kb/ contains non-store files:\n  ${offenders.join("\n  ")}`,
    );
  }
  // Remove only the store subdirectories; keep root-level .base/README.md.
  for (const d of readdirSync(targetDir, { withFileTypes: true })) {
    if (d.isDirectory()) rmSync(join(targetDir, d.name), { recursive: true });
  }
}
mkdirSync(targetDir, { recursive: true });

// ---------------------------------------------------------------------------
// 3. Write one md file per object
// ---------------------------------------------------------------------------
let normalized = 0;
const normalizedSlugs = [];
for (const [schema, entries] of store) {
  const schemaDir = join(targetDir, schema);
  mkdirSync(schemaDir);
  for (const [slug, entry] of entries) {
    const { notes, ...fields } = entry;
    let out = `---\n${yaml.dump(fields, { lineWidth: -1 })}---\n`;
    if (typeof notes === "string") {
      const canonical = normalizeNotes(notes);
      if (canonical !== notes) {
        normalized++;
        normalizedSlugs.push(`${schema}/${slug}`);
      }
      out += `\n${canonical}\n`;
    }
    writeFileSync(join(schemaDir, `${slug}.md`), out, "utf8");
  }
}

// ---------------------------------------------------------------------------
// 4. Fidelity proof — re-read every file, reconstruct, deepStrictEqual
// ---------------------------------------------------------------------------
function parseMd(content, label) {
  if (!content.startsWith("---\n")) fail(`${label}: missing opening delimiter`);
  const close = content.indexOf("\n---\n", 3);
  if (close === -1) fail(`${label}: missing closing delimiter`);
  const frontmatter = yaml.load(content.slice(4, close + 1)) ?? {};
  let body = content.slice(close + 5);
  if (body.startsWith("\n")) body = body.slice(1); // ONE leading blank line
  body = body.replace(/\s+$/u, ""); // ALL trailing whitespace
  return { frontmatter, body };
}

let total = 0;
const counts = {};
let failures = 0;
for (const [schema, entries] of store) {
  counts[schema] = 0;
  for (const [slug, entry] of entries) {
    const label = `${schema}/${slug}`;
    const content = readFileSync(join(targetDir, schema, `${slug}.md`), "utf8");
    const { frontmatter, body } = parseMd(content, label);
    const reconstructed = {
      ...frontmatter,
      ...(body !== "" ? { notes: body } : {}),
    };
    const expected = { ...entry };
    if (typeof entry.notes === "string")
      expected.notes = normalizeNotes(entry.notes);
    try {
      assert.deepStrictEqual(reconstructed, expected);
    } catch (err) {
      failures++;
      console.error(`MISMATCH ${label}\n${err.message}\n`);
      continue;
    }
    counts[schema]++;
    total++;
  }
}

if (failures > 0) fail(`${failures} object(s) failed the round-trip proof`);

// Also prove the tree contains nothing beyond what we just verified.
for (const [schema, entries] of store) {
  const onDisk = readdirSync(join(targetDir, schema)).filter((f) =>
    f.endsWith(".md"),
  );
  if (onDisk.length !== entries.size) {
    fail(
      `${schema}: ${onDisk.length} files on disk vs ${entries.size} entries`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. Report
// ---------------------------------------------------------------------------
console.log(
  "Round-trip fidelity proof (parse → write → re-read → deepStrictEqual):",
);
for (const schema of Object.keys(counts).sort(
  (a, b) => counts[b] - counts[a],
)) {
  console.log(`  ${schema} ${counts[schema]}/${store.get(schema).size}`);
  if (counts[schema] !== EXPECTED_COUNTS[schema]) {
    fail(
      `${schema}: expected ${EXPECTED_COUNTS[schema]} objects, proved ${counts[schema]}`,
    );
  }
}
console.log(`  total ${total}/422`);
if (total !== 422) fail(`expected 422 objects, proved ${total}`);
if (normalized > 0) {
  console.log(
    `Normalized at conversion: ${normalized} notes value(s) had trailing whitespace/newlines stripped (cannot round-trip through the body-reattachment rule):`,
  );
  for (const s of normalizedSlugs) console.log(`  ${s}`);
} else {
  console.log("Normalized at conversion: 0 notes values.");
}
console.log(
  "OK — every object round-trips byte-exactly under the store contract.",
);
