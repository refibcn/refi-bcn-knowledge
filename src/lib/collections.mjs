// Collections: curated sub-scopes over the KMS store (D6). Definitions, never
// copies — this module computes membership; it never stores object content.
//
// Dual-path contract — a HYBRID, not a fork (correction 2026-08-10, code
// review on e7fb22b). The first draft copied sources.mjs's early-return fork,
// which is wrong here: sources.mjs may legitimately return `objects: []` on
// the summary path because /sources deliberately renders zero object bodies
// publicly. A collection's entire job is to LIST its public entries, and
// `usingCommittedStore()` is the *permanent* CI branch (true forever once
// `data/kb-public/` holds real published objects, not a transitional state) —
// so a fork would leave `public_entries` permanently empty in CI. The correct
// sibling is src/pages/knowledge.astro: `loadKb()` always returns the right
// source to RENDER from (workspace store or the committed public subset —
// exactly `publishableKb()`), while aggregate COUNTS come from the committed
// summary when there is no workspace store to count from directly. So here:
// `objects` is loaded the same way on both paths and drives `members` /
// `public_entries` on both paths; only the *counts* switch source. `from_summary`
// is diagnostic only — same rule as the `from_summary` note on sources.mjs's
// `sourcesViewModel` — no page may branch on it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { z } from "zod";
import {
  loadKb,
  sourceContainers,
  publishableKb,
  UNATTRIBUTED,
  sortedCounts,
} from "./kb.mjs";
import { usingCommittedStore, kbSummary, SUMMARY_FILE } from "./kb-summary.mjs";

// Repo-root walk, same as kb.mjs — see its header before "simplifying" this.
function findRepoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error("collections.mjs: no package.json above this module");
    dir = parent;
  }
  return dir;
}
export const COLLECTIONS_FILE = resolve(
  findRepoRoot(),
  "src",
  "data",
  "collections.yaml",
);

const axis = z.array(z.string()).default([]);
// `.strict()` on the outer schema AND both nested axis objects. Without it,
// zod 3 silently strips unknown keys, and combined with `hit()`'s "empty axis
// constrains nothing" rule, a typo'd `includes:`/`excludes:` (the likeliest
// misspelling in English) turns a curated sub-scope into the ENTIRE store with
// no error anywhere — a misspelling failing OPEN to 422 objects instead of
// failing closed. Reproduced in review on e7fb22b; `.strict()` is what makes
// "empty means unconstrained" a safe default rather than a silent trap.
const CollectionSchema = z
  .object({
    title: z.string().min(1),
    status: z.enum(["defining", "curating", "published"]),
    audience: z.string().default(""),
    goal: z.string().default(""),
    scope: z.string().default(""),
    include: z
      .object({ containers: axis, domains: axis, schemas: axis, ids: axis })
      .strict()
      .default({}),
    exclude: z.object({ ids: axis }).strict().default({}),
  })
  .strict();

/** True IFF `v` is a non-array, non-null object with at least one own key —
 *  the shape a `collections:` map must have. Rejects `{collections: null}`,
 *  `{collections: []}` and a doc with no `collections:` key at all (e.g. an
 *  empty YAML file parses to `undefined`). */
function isNonEmptyPlainObject(v) {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length > 0
  );
}

/** Validated {id: definition}. Throws on a malformed file — a bad definition
 *  must fail the build, not render an empty collection. */
export function parseCollections(doc) {
  const collections = doc?.collections;
  if (!isNonEmptyPlainObject(collections)) {
    throw new Error(
      `collections: expected a non-empty \`collections:\` map, got ${JSON.stringify(collections)}`,
    );
  }
  const out = {};
  for (const [id, def] of Object.entries(collections)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
      throw new Error(`collections: bad id "${id}"`);
    try {
      out[id] = { id, ...CollectionSchema.parse(def) };
    } catch (e) {
      if (!(e instanceof z.ZodError)) throw e;
      // Name the collection AND the file — a bare ZodError with path
      // ["status"] tells an operator nothing when the file holds several
      // definitions.
      throw new Error(
        `collections: "${id}" in ${COLLECTIONS_FILE} is invalid — ` +
          e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
  }
  return out;
}

export function loadCollections(file = COLLECTIONS_FILE) {
  if (!existsSync(file)) {
    throw new Error(
      `collections.mjs: missing ${file}. It is the hand-authored collection ` +
        "definitions file (not generated) — see src/data/collections.yaml for the shape.",
    );
  }
  return parseCollections(yaml.load(readFileSync(file, "utf8")));
}

// Empty axis = unconstrained, by design: a collection that names no domains
// should not match zero objects on the domain axis, it should match on the
// OTHER axes alone. This is exactly the rule `.strict()` above exists to keep
// safe — without it, a typo'd axis key silently becomes an always-empty (and
// therefore always-unconstrained) axis instead of a validation error.
const hit = (list, v) => list.length === 0 || list.includes(v);

// The shape a summary rollup entry must have. `.strict()` is the guard that
// matters: the neighbouring containers rollup in derive-kb-summary.mjs names
// its count `objects_total`, not `members_total` — a future collections
// rollup that reuses that shape by habit would, without `.strict()`, simply
// have its `objects_total` key stripped and `members_total` silently read as
// `undefined`. The build would stay green and every collection would render
// "undefined members". `.strict()` turns that into a named validation error
// naming the exact mismatch.
const RollupSchema = z
  .object({
    members_total: z.number().int().nonnegative(),
    publishable_total: z.number().int().nonnegative(),
    by_schema: z.record(z.number()),
    by_container: z.record(z.number()),
  })
  .strict();

/** Membership: (all include axes match) OR explicit include id; excludes always
 *  win. `containerOf(objectId)` keeps this module free of a second grouping
 *  implementation — the caller supplies attribution from sourceContainers. */
export function collectionMembers(def, objects, containerOf) {
  const inc = def.include,
    exIds = new Set(def.exclude.ids);
  return objects.filter((o) => {
    if (o.schema === "source-system") return false; // cards are infrastructure
    if (exIds.has(o.id)) return false;
    if (inc.ids.includes(o.id)) return true;
    return (
      hit(inc.containers, containerOf(o.id)) &&
      hit(inc.domains, o.domain) &&
      hit(inc.schemas, o.schema)
    );
  });
}

/**
 * The summary's `collections` rollup for one collection, validated PRESENT
 * and validated SHAPE. Throws rather than degrading to zeros or `undefined`
 * — same reasoning as `kbSummary()` and `disposition()` in kb.mjs: "0
 * members" is a claim about the corpus, and it is the one value that is both
 * plausible and wrong when the real statement is "the build has not been
 * taught this collection yet". This is the exact failure mode that nearly
 * shipped a "Sources 0 · Objects 0" page on 2026-08-10 — reproduced again on
 * this module's own first draft (15 members in the workspace, 0 in a clone
 * simulation, tests green both ways) before the presence guard existed.
 *
 * The shape guard (RollupSchema) exists for a second, subtler version of the
 * same failure: present-but-wrong. A rollup entry that reuses a neighbouring
 * shape by habit (e.g. `objects_total` instead of `members_total`, matching
 * derive-kb-summary.mjs's CONTAINER_KEYS) would otherwise pass the presence
 * check, then read as `undefined` — plausible, silent, and wrong in exactly
 * the same way.
 *
 * @param {Record<string, any>} summaryDoc  Injectable for tests; defaults to
 *   the real committed file via kbSummary().
 * @param {string} id
 */
function summaryAggFor(summaryDoc, id) {
  const agg = summaryDoc.collections;
  if (!agg) {
    throw new Error(
      `collections.mjs: ${SUMMARY_FILE} carries no \`collections\` rollup. ` +
        "It is a committed artifact — run `npm run derive:kb-summary` inside a refi-bcn-os checkout.",
    );
  }
  const a = agg[id];
  if (!a) {
    throw new Error(
      `collections.mjs: no rollup for collection "${id}" — re-run \`npm run derive:kb-summary\` after editing ${COLLECTIONS_FILE}.`,
    );
  }
  try {
    return RollupSchema.parse(a);
  } catch (e) {
    if (!(e instanceof z.ZodError)) throw e;
    throw new Error(
      `collections.mjs: malformed rollup for "${id}" in ${SUMMARY_FILE} — ` +
        e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") +
        ". Re-run `npm run derive:kb-summary`.",
    );
  }
}

/**
 * One row shape, both paths — see the module header for why this is a hybrid
 * rather than a fork. `members`/`public_entries` are always computed live
 * from `objects` (workspace store or the committed public subset); only the
 * four aggregate COUNTS switch source when there is no workspace store.
 *
 * Every parameter is injectable, the way `resolveKbDir({workspaceExists})`
 * already is in kb.mjs — so tests can exercise either branch, or both
 * branches against the SAME fixture objects, without depending on the real
 * store or the real committed summary.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.internal]
 * @param {import("./kb.mjs").KbObject[]} [opts.objects]  Defaults to loadKb().
 * @param {boolean} [opts.fromSummary]  Defaults to usingCommittedStore().
 * @param {Record<string, any>} [opts.summary]  Defaults to kbSummary(); only
 *   consulted when `fromSummary` is true.
 * @param {Record<string, ReturnType<typeof parseCollections>[string]>} [opts.defs]
 *   Defaults to loadCollections().
 */
export function collectionsViewModel({
  internal = false,
  objects = loadKb(),
  fromSummary = usingCommittedStore(),
  summary,
  defs = loadCollections(),
} = {}) {
  const summaryDoc = fromSummary ? (summary ?? kbSummary()) : null;

  const containers = sourceContainers(objects);
  const byObject = new Map();
  for (const c of containers)
    for (const obj of c.objects) byObject.set(obj.id, c.id);
  const containerOf = (id) => byObject.get(id) ?? UNATTRIBUTED;
  const pub = new Set(publishableKb(objects).map((obj) => obj.id));

  const rows = Object.values(defs).map((def) => {
    const members = collectionMembers(def, objects, containerOf);
    const bySchemaTally = new Map();
    const byContainerTally = new Map();
    for (const m of members) {
      bySchemaTally.set(m.schema, (bySchemaTally.get(m.schema) ?? 0) + 1);
      const c = containerOf(m.id);
      byContainerTally.set(c, (byContainerTally.get(c) ?? 0) + 1);
    }
    const by_schema = sortedCounts(bySchemaTally);
    const by_container = sortedCounts(byContainerTally);
    const public_entries = members.filter((m) => pub.has(m.id));

    // Aggregate COUNTS come from the committed rollup when there is no
    // workspace store to count from directly; `members`/`public_entries`
    // themselves are always the live computation above, on both paths.
    const a = summaryDoc ? summaryAggFor(summaryDoc, def.id) : null;

    return {
      ...def,
      members: internal ? members : [],
      public_entries,
      members_total: a ? a.members_total : members.length,
      publishable_total: a ? a.publishable_total : public_entries.length,
      by_schema: a ? a.by_schema : by_schema,
      by_container: a ? a.by_container : by_container,
      href: `collections/${def.id}/`,
    };
  });

  return {
    rows,
    // Diagnostic only — no page may branch on it, or the two paths start
    // drifting again. Same rule as the `from_summary` note on sources.mjs's
    // `sourcesViewModel`.
    from_summary: fromSummary,
  };
}
