// Whether a failed CRM (Notion) feed degrades to a banner or stops the build.
//
// Every CRM-fed page — /organizations, /programs, /events, /priorities,
// /priorities/[id], /atlas — catches its own fetch failure and renders a
// "Data error" banner over an empty dataset. That is the right behaviour on a
// laptop with no NOTION_API_KEY: you can still work on /knowledge, /sources and
// the atlas geometry without Notion access, and the build exits 0.
//
// It is the wrong behaviour in CI. The Pages workflow rebuilds on a 6-hourly
// cron, so a missing, expired or revoked secret would quietly publish a site
// covered in error banners with every directory emptied — replacing a good live
// deployment, unattended. There, the build must fail: a red run leaves the last
// good deployment serving.
//
// So the pages route their catch through `crmFailure()` and CI opts in with
// REQUIRE_NOTION=1 (see .github/workflows/deploy.yml). The check lives here, as
// a pure function over the flag's value, so it is testable without a build.
// Callers pass `import.meta.env.REQUIRE_NOTION` rather than the whole env bag:
// Vite rewrites `import.meta.env.X` per key at build time, and handing the bare
// `import.meta.env` object to a function trips its transform (esbuild:
// `Unexpected "env"`).

/**
 * True when this build refuses to ship placeholder CRM data.
 * @param {unknown} flag  Usually `import.meta.env.REQUIRE_NOTION`.
 * @returns {boolean}
 */
export function crmRequired(flag) {
  return String(flag ?? "") === "1";
}

/**
 * Turn a caught CRM failure into either a banner message (soft, the default)
 * or a thrown build error (strict, when REQUIRE_NOTION=1).
 *
 * @param {unknown} error    Whatever the catch block received.
 * @param {string} context   What was being fetched, e.g. "actors".
 * @param {unknown} flag     Usually `import.meta.env.REQUIRE_NOTION`.
 * @returns {string} The banner message. Never returns under REQUIRE_NOTION=1.
 */
export function crmFailure(error, context, flag) {
  const raw =
    error && typeof error === "object" && typeof error.message === "string"
      ? error.message
      : "";
  const message = raw || `Failed to fetch ${context} from Notion.`;

  if (!crmRequired(flag)) return message;

  throw new Error(
    `CRM feed unavailable while building ${context}: ${message}\n` +
      `REQUIRE_NOTION=1, so this build refuses to publish empty directories. ` +
      `Check the NOTION_API_KEY secret — missing, expired or revoked keys all ` +
      `land here, as does a Notion API outage. Failing keeps the last good ` +
      `deployment serving.`,
  );
}
