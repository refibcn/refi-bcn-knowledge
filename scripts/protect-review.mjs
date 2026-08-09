// Encrypts ONLY the /review page into a self-contained deploy dir
// (dist-review-protected/). Never touches the public site's deploy.
// Password comes ONLY from env — never hardcode, never commit.
//
// The DEPLOY TARGET keeps its original name — the `refibcn/commons-review`
// bucket. That is a private artifact bucket nobody browses by name, and
// renaming it would break the staticrypt "remember me" origin for no gain.
// Only the local page route and build dir follow BD-2026-060.
import { spawnSync } from "node:child_process";
import { rmSync, mkdirSync, existsSync, writeFileSync } from "node:fs";

const pwd = process.env.STATICRYPT_PASSWORD;
if (!pwd) {
  console.error(
    "STATICRYPT_PASSWORD not set — refusing to build an unprotected deploy.",
  );
  process.exit(1);
}
if (!existsSync("dist/review/index.html")) {
  console.error("dist/review/index.html missing — run `astro build` first.");
  process.exit(1);
}

rmSync("dist-review-protected", { recursive: true, force: true });
mkdirSync("dist-review-protected", { recursive: true });

// Run from inside the page dir so the encrypted file lands at the deploy root.
// Salt config (.staticrypt.json) is kept at the REPO root so "remember me"
// survives redeploys — committed on first generation.
const res = spawnSync(
  "npx",
  [
    "staticrypt",
    "index.html",
    "-c",
    "../../.staticrypt.json",
    "-d",
    "../../dist-review-protected",
    "--short",
    "--remember",
    "30",
    "--template-title",
    "ReFi BCN — internal review",
  ],
  { cwd: "dist/review", stdio: "inherit", env: { ...process.env } },
);
if (res.status !== 0) process.exit(res.status ?? 1);

writeFileSync(
  "dist-review-protected/robots.txt",
  "User-agent: *\nDisallow: /\n",
);
console.log("dist-review-protected/ ready.");
