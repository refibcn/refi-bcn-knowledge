/** Site identity, loaded once from `src/data/site.yaml`.
 *
 * Path resolution note — read this before adding another data loader:
 *
 *   - `process.cwd()` is wrong: it depends on where the build was invoked
 *     from, so it silently works from the repo root and breaks everywhere else.
 *   - `import.meta.url` is *also* wrong for anything a component imports.
 *     Astro bundles `src/lib` into `dist/`, so at build time `import.meta.url`
 *     resolves against the emitted chunk and you get `dist/data/site.yaml`.
 *   - The correct answer for component-consumed data is a Vite `?raw` import:
 *     the file is inlined into the bundle at build time, so there is no runtime
 *     filesystem read and no path to get wrong.
 *
 * Standalone scripts under `scripts/` are a different context — they run under
 * plain Node, are not bundled, and there `import.meta.url` is the right tool.
 *
 * A missing or malformed key fails the build loudly here rather than rendering
 * an empty `<title>` in production.
 */
import yaml from "js-yaml";
import siteYaml from "../data/site.yaml?raw";

export interface Site {
  /** Display name used in the nav brand, page titles and footer lockup. */
  name: string;
  /** Absolute origin, used to build canonical URLs. */
  url: string;
  /** Default meta description. */
  description: string;
  /** Legal / status line in the footer. */
  legalNote: string;
  /** When false, Layout emits a site-wide `<meta name="robots" content="noindex">`.
   *  The hub is internal-in-purpose while curation runs; the September launch
   *  flips this to true in site.yaml and nothing else moves. */
  indexing: boolean;
}

const SOURCE = "src/data/site.yaml";

const REQUIRED_KEYS = ["name", "url", "description", "legalNote"] as const;

function loadSite(): Site {
  const parsed: unknown = yaml.load(siteYaml);

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${SOURCE} did not parse to a mapping.`);
  }

  const record = parsed as Record<string, unknown>;
  const missing = REQUIRED_KEYS.filter((key) => {
    const value = record[key];
    return typeof value !== "string" || value.trim() === "";
  });

  if (missing.length > 0) {
    throw new Error(
      `${SOURCE} is missing required non-empty string key(s): ${missing.join(", ")}.`,
    );
  }

  const url = record["url"] as string;
  if (!URL.canParse(url)) {
    throw new Error(`${SOURCE} "url" is not an absolute URL: ${url}`);
  }

  // Explicitly boolean, and REQUIRED: an absent key must not silently mean
  // "indexable". Making the author write `indexing: true` is what makes the
  // launch flip a deliberate act rather than a default nobody chose.
  if (typeof record["indexing"] !== "boolean") {
    throw new Error(
      `${SOURCE} "indexing" must be an explicit boolean — false while the hub is internal, true at launch.`,
    );
  }

  return {
    name: record["name"] as string,
    url,
    description: record["description"] as string,
    legalNote: record["legalNote"] as string,
    indexing: record["indexing"],
  };
}

export const site: Site = loadSite();
