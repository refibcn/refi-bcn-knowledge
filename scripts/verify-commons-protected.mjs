// Hard deploy gate for the commons review artifact: must be encrypted,
// self-contained, and leak zero plaintext store content.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Real strings from the KB store — if any appears in plaintext in the deploy
// dir, content escaped the encrypted payload.
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

const files = walk("dist-commons-protected");
const htmls = files.filter((f) => f.endsWith(".html"));
let ok = true;

if (htmls.length !== 1 || !htmls[0].endsWith("index.html")) {
  console.error(
    `FAIL: expected exactly one HTML (index.html), found: ${htmls.join(", ") || "none"}`,
  );
  ok = false;
}
const page = readFileSync(join("dist-commons-protected", "index.html"), "utf8");
if (!/staticrypt/i.test(page)) {
  console.error(
    "FAIL: index.html has no staticrypt marker — page is NOT encrypted.",
  );
  ok = false;
}
if (page.includes("/_astro")) {
  console.error("FAIL: page references /_astro — not self-contained.");
  ok = false;
}
for (const f of files) {
  const body = readFileSync(f, "utf8");
  for (const c of CANARIES) {
    if (body.includes(c)) {
      console.error(`FAIL: canary "${c}" found in plaintext in ${f}`);
      ok = false;
    }
  }
}
if (!ok) process.exit(1);
console.log(
  `OK: 1 encrypted page, ${files.length} files, no canary leaks, self-contained.`,
);
