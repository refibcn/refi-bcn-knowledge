// Encrypts ONLY the commons-review page into a self-contained deploy dir
// (dist-commons-protected/). Never touches the public site's deploy.
// Password comes ONLY from env — never hardcode, never commit.
import { spawnSync } from "node:child_process";
import { rmSync, mkdirSync, existsSync, writeFileSync } from "node:fs";

const pwd = process.env.STATICRYPT_PASSWORD;
if (!pwd) {
  console.error(
    "STATICRYPT_PASSWORD not set — refusing to build an unprotected deploy.",
  );
  process.exit(1);
}
if (!existsSync("dist/commons-review/index.html")) {
  console.error(
    "dist/commons-review/index.html missing — run `astro build` first.",
  );
  process.exit(1);
}

rmSync("dist-commons-protected", { recursive: true, force: true });
mkdirSync("dist-commons-protected", { recursive: true });

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
    "../../dist-commons-protected",
    "--short",
    "--remember",
    "30",
    "--template-title",
    "ReFi BCN — internal review",
  ],
  { cwd: "dist/commons-review", stdio: "inherit", env: { ...process.env } },
);
if (res.status !== 0) process.exit(res.status ?? 1);

writeFileSync(
  "dist-commons-protected/robots.txt",
  "User-agent: *\nDisallow: /\n",
);
console.log("dist-commons-protected/ ready.");
