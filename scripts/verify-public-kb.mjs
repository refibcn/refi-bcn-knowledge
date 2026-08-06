// Public-dist gate: NO raw KB content may appear anywhere under dist/.
// Runs after every plain `astro build`. The bucket build (COMMONS_REVIEW=1)
// intentionally embeds the dataset → the gate skips there (its own gate,
// verify-commons-protected.mjs, covers that artifact).
import { readFileSync, readdirSync, statSync } from "node:fs";
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
if (!ok) process.exit(1);
console.log("verify-public-kb: OK — no raw KB content in the public dist.");
