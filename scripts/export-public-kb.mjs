// Writes the public subset of the workspace KMS store to data/kb-public/.
//
// Why this exists: CI builds this repo as a standalone clone with no access to
// the refi-bcn-os workspace `data/kb/`. It reads the committed subset instead.
// The subset is produced by the SAME fail-closed filter the site renders with
// (publishableKb), so committing it leaks nothing by construction — it is
// exactly what would publish. Today that is zero objects, because nothing has
// been reviewed yet. That is the filter working, not a bug.
//
// Runs under plain Node (unbundled), so `import.meta.url` is this file — but
// paths still come from kb.mjs so there is one definition. See the path
// resolution note in src/lib/kb.mjs.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import {
  loadKb,
  publishableKb,
  resolveKbDir,
  PUBLIC_KB_DIR,
} from "../src/lib/kb.mjs";

// Compare canonically on both sides: resolveKbDir() realpath-resolves its input,
// so an un-resolved PUBLIC_KB_DIR would miss the match if the checkout path
// itself contains a symlink.
const source = resolveKbDir();
const ownOutput = existsSync(PUBLIC_KB_DIR)
  ? realpathSync(PUBLIC_KB_DIR)
  : PUBLIC_KB_DIR;
if (source === ownOutput) {
  console.error(
    "export-public-kb: no workspace store to export from " +
      "(resolved to data/kb-public/, which is this script's own output).\n" +
      "Run inside a refi-bcn-os checkout, or set KB_DIR.",
  );
  process.exit(1);
}

const objects = loadKb(source);
const published = publishableKb(objects);

const bySchema = new Map();
for (const o of published) {
  if (!bySchema.has(o.schema)) bySchema.set(o.schema, {});
  bySchema.get(o.schema)[o.slug] = o.raw;
}

mkdirSync(PUBLIC_KB_DIR, { recursive: true });
for (const f of readdirSync(PUBLIC_KB_DIR)) {
  if (f.endsWith(".yaml")) rmSync(join(PUBLIC_KB_DIR, f));
}

const header =
  "# GENERATED — do not edit by hand. Written by `npm run export:public-kb`.\n" +
  "# Source: the refi-bcn-os workspace store, filtered by publishableKb()\n" +
  "# (fail-closed). This file is exactly what the public commons renders.\n";

for (const [schema, entries] of [...bySchema].sort()) {
  writeFileSync(
    join(PUBLIC_KB_DIR, `${schema}.yaml`),
    header + yaml.dump({ entries }, { noRefs: true, lineWidth: 100 }),
    "utf8",
  );
  console.log(`  ${schema}: ${Object.keys(entries).length}`);
}

console.log(
  `export-public-kb: ${published.length} objects exported to data/kb-public/ ` +
    `(from ${objects.length} in ${source}).`,
);
