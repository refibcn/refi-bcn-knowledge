// The KB source seam: where loadKb() reads the store from.
//
// Three sources, in precedence order — KB_DIR env, the workspace store inside a
// refi-bcn-os checkout, then the committed public subset (data/kb-public/) that
// a standalone CI clone gets. Paths are anchored on the repo root rather than on
// `import.meta.url`; see the comment block in src/lib/kb.mjs for why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadKb, resolveKbDir } from "../src/lib/kb.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC_DIR = resolve(REPO_ROOT, "data", "kb-public");
const WORKSPACE_DIR = resolve(REPO_ROOT, "..", "..", "data", "kb");

test("KB_DIR env wins", () => {
  process.env.KB_DIR = "/tmp/kb-x";
  try {
    assert.equal(resolveKbDir(), "/tmp/kb-x");
    assert.equal(
      resolveKbDir({ workspaceExists: false }),
      "/tmp/kb-x",
      "env beats the public fallback too",
    );
  } finally {
    delete process.env.KB_DIR;
  }
});

test("uses the workspace store when it is present", () => {
  assert.equal(resolveKbDir({ workspaceExists: true }), WORKSPACE_DIR);
});

test("falls back to committed public store when workspace store is absent", () => {
  assert.equal(resolveKbDir({ workspaceExists: false }), PUBLIC_DIR);
});

// Only meaningful inside a refi-bcn-os checkout. A standalone CI clone has no
// workspace store — that case is covered by the fallback test above.
test(
  "default probe reflects this checkout (workspace store present here)",
  { skip: !existsSync(WORKSPACE_DIR) },
  () => {
    assert.equal(resolveKbDir(), WORKSPACE_DIR);
  },
);

// What a standalone CI clone actually does: read the committed public store.
// Nothing is `reviewed` yet, so the export is empty — that must load as an
// empty commons, not crash the build.
test("the committed public store loads (empty today, by design)", () => {
  assert.deepEqual(loadKb(PUBLIC_DIR), []);
});
