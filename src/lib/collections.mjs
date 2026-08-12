// Collections: curated sub-scopes over the KMS store (D6). Definitions, never
// copies — this module computes membership; it never stores object content.
//
// Everything is computed live from `objects` (the in-repo store via loadKb()):
// `members`, `public_entries`, and the four aggregate counts alike. The
// dual-path hybrid this module used to implement — live computation for the
// entries, a committed summary rollup for the counts on a store-less clone —
// retired with the md-store migration: every clone now carries the store, so
// there is exactly one computation and nothing for the two paths to disagree
// about.
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
 * Rows for /collections and /collections/<id>. Everything — members, public
 * entries, and the four aggregate counts — is one live computation over
 * `objects`; see the module header.
 *
 * `objects` and `defs` stay injectable so tests can drive the whole pipeline
 * from fixtures without depending on the real store or the real definitions
 * file.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.internal]
 * @param {import("./kb.mjs").KbObject[]} [opts.objects]  Defaults to loadKb().
 * @param {Record<string, ReturnType<typeof parseCollections>[string]>} [opts.defs]
 *   Defaults to loadCollections().
 */
export function collectionsViewModel({
  internal = false,
  objects = loadKb(),
  defs = loadCollections(),
} = {}) {
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

    return {
      ...def,
      members: internal ? members : [],
      public_entries,
      members_total: members.length,
      publishable_total: public_entries.length,
      by_schema,
      by_container,
      href: `collections/${def.id}/`,
    };
  });

  return { rows };
}
