// The CRM-strict seam: soft banner locally, hard build failure in CI.
//
// The first group pins the decision function itself. The last one is the one
// that actually protects the deploy: it walks every page that fetches from
// Notion and demands the catch route through `crmFailure()`. A new CRM-fed page
// that swallows its own error would otherwise reopen exactly the hole this
// exists to close — publish-a-broken-site-on-cron — and no unit test of
// crm-strict.mjs would notice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crmFailure, crmRequired } from "../src/lib/crm-strict.mjs";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

test("crmRequired: only the exact opt-in enables strict mode", () => {
  assert.equal(crmRequired("1"), true);
  assert.equal(crmRequired(1), true);
  for (const flag of ["", "0", "true", "yes", undefined, null, false]) {
    assert.equal(
      crmRequired(flag),
      false,
      `expected soft for ${JSON.stringify(flag)}`,
    );
  }
});

test("crmFailure: soft mode returns the error's message for the banner", () => {
  const message = crmFailure(
    new Error("NOTION_API_KEY is not set"),
    "actors",
    undefined,
  );
  assert.equal(message, "NOTION_API_KEY is not set");
});

test("crmFailure: soft mode falls back to a context-named message", () => {
  assert.equal(
    crmFailure(new Error(""), "programs", ""),
    "Failed to fetch programs from Notion.",
  );
  // Non-Error throws (a string, undefined) must not produce "undefined".
  assert.equal(
    crmFailure("boom", "events", undefined),
    "Failed to fetch events from Notion.",
  );
  assert.equal(
    crmFailure(undefined, "events", "0"),
    "Failed to fetch events from Notion.",
  );
});

test("crmFailure: strict mode throws, naming the secret and the context", () => {
  assert.throws(
    () => crmFailure(new Error("NOTION_API_KEY is not set"), "actors", "1"),
    (e) => {
      assert.match(e.message, /NOTION_API_KEY/);
      assert.match(e.message, /actors/);
      assert.match(e.message, /REQUIRE_NOTION=1/);
      return true;
    },
  );
});

test("crmFailure: strict mode also throws for a live API failure, not just a missing key", () => {
  // An expired or revoked key surfaces as a 401 from the Notion client, not as
  // "NOTION_API_KEY is not set" — the case a workflow-level secret preflight
  // cannot see, and the reason this seam is in the build rather than in YAML.
  assert.throws(
    () => crmFailure(new Error("API token is invalid."), "programs", "1"),
    /API token is invalid\.[\s\S]*NOTION_API_KEY/,
  );
});

test("every Notion-fed page routes its catch through crmFailure", () => {
  const pagesDir = join(ROOT, "src", "pages");
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const p = join(dir, entry.name);
      return entry.isDirectory() ? walk(p) : [p];
    });

  const fed = walk(pagesDir)
    .filter((p) => p.endsWith(".astro"))
    .map((p) => [p, readFileSync(p, "utf8")])
    .filter(([, body]) => /fetchDatabaseRecords|fetchAtlasRecords/.test(body));

  // Six today: organizations, programs, events, priorities/index,
  // priorities/[id], atlas. The count is asserted so that deleting the seam
  // from every page cannot pass this test vacuously.
  assert.equal(fed.length, 6, `Notion-fed pages found: ${fed.length}`);

  for (const [path, body] of fed) {
    const rel = path.slice(ROOT.length);
    assert.match(
      body,
      /from ["'][./]*(\.\.\/)*lib\/crm-strict\.mjs["']/,
      `${rel} fetches from Notion but does not import crm-strict.mjs`,
    );
    assert.match(
      body,
      /crmFailure\(/,
      `${rel} fetches from Notion but does not route its catch through crmFailure()`,
    );
    // A second `catch (e) { x = e.message ?? "…" }` alongside crmFailure would
    // still swallow a failure, so the old shapes must be gone entirely.
    assert.doesNotMatch(
      body,
      /=\s*e\.message\s*\?\?|e instanceof Error \? e\.message/,
      `${rel} still has a catch that swallows the error straight into a banner`,
    );
  }
});
