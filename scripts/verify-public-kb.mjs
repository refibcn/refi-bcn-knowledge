// Public-dist gate: NO raw KB content may appear anywhere under dist/.
// Runs after every plain `astro build`. The bucket build (COMMONS_REVIEW=1)
// intentionally embeds the dataset → the gate skips there (its own gate,
// verify-review-protected.mjs, covers that artifact).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

if (process.env.COMMONS_REVIEW === "1") {
  console.log("verify-public-kb: skipped (internal COMMONS_REVIEW build).");
  process.exit(0);
}
const CANARIES = [
  "refi-barcelona-gg24-round-proposal",
  "surfaced_by",
  "old-KB reprocessing",
];
const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
let ok = true;
for (const f of walk("dist")) {
  const body = readFileSync(f, "utf8");
  for (const c of CANARIES)
    if (body.includes(c)) {
      console.error(`FAIL: canary "${c}" in ${f}`);
      ok = false;
    }
}

// ── Listing surfaces: summaries only (DC-2 / DC-3) ───────────────────────
// These are the public surfaces that know a full object list — /sources per
// container, /collections per curated sub-scope, /slices per crosscut — so
// they are the likeliest place for a listing to leak in by accident: an
// `INTERNAL ?` branch dropped during a refactor would not fail any test.
// This checks the built output for object DETAIL links, which only the
// internal listings emit. Counts, status chips, the archive checklist and the
// collection definition stay allowed; those are the point of the pages.
//
// `slices` arrives in Phase 4. It is listed now rather than later so the gate
// covers the surface the day it appears instead of the day someone remembers
// to widen this array — an absent directory is reported below, not skipped in
// silence, so "checked" never quietly means "found nothing to check".
const LISTING_SECTIONS = ["sources", "collections", "slices"];
for (const section of LISTING_SECTIONS) {
  const dir = join("dist", section);
  if (!existsSync(dir)) {
    console.log(
      `verify-public-kb: no dist/${section} in this build — nothing to check.`,
    );
    continue;
  }
  const pages = walk(dir).filter((x) => x.endsWith(".html"));
  for (const f of pages) {
    const body = readFileSync(f, "utf8");
    // `review/#/o/<schema>/<slug>` is emitted once per object by the internal
    // listings and never by the public branch.
    const objectLinks = body.match(/review\/#\/o\//g);
    if (objectLinks) {
      console.error(
        `FAIL: ${f} carries ${objectLinks.length} per-object review links — the internal listing leaked into the public build.`,
      );
      ok = false;
    }
  }
  console.log(
    `verify-public-kb: checked ${pages.length} dist/${section} pages for object listings.`,
  );
}

if (!ok) process.exit(1);
console.log("verify-public-kb: OK — no raw KB content in the public dist.");
