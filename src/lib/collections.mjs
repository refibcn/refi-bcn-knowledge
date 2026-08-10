// Collections: curated sub-scopes over the KMS store (D6). Definitions, never
// copies — this module computes membership; it never stores object content.
//
// Dual-path contract (COPIED from sources.mjs, deliberately): live store inside
// a refi-bcn-os checkout, committed aggregate summary in a standalone CI clone.
// Rows carry the same fields on both paths; `members`/`public_entries` are []
// on the summary path and every count comes from a named field.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { z } from "zod";
import { loadKb, sourceContainers, publishableKb } from "./kb.mjs";
import { usingCommittedStore, kbSummary } from "./kb-summary.mjs";

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
const CollectionSchema = z.object({
  title: z.string().min(1),
  status: z.enum(["defining", "curating", "published"]),
  audience: z.string().default(""),
  goal: z.string().default(""),
  scope: z.string().default(""),
  include: z
    .object({ containers: axis, domains: axis, schemas: axis, ids: axis })
    .default({}),
  exclude: z.object({ ids: axis }).default({}),
});

/** Validated {id: definition}. Throws on a malformed file — a bad definition
 *  must fail the build, not render an empty collection. */
export function parseCollections(doc) {
  const out = {};
  for (const [id, def] of Object.entries(doc?.collections ?? {})) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
      throw new Error(`collections: bad id "${id}"`);
    out[id] = { id, ...CollectionSchema.parse(def) };
  }
  return out;
}

export function loadCollections(file = COLLECTIONS_FILE) {
  return parseCollections(yaml.load(readFileSync(file, "utf8")));
}

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

/** One row shape, both paths. */
export function collectionsViewModel({ internal = false } = {}) {
  const defs = loadCollections();
  const fromSummary = usingCommittedStore();

  if (fromSummary) {
    const agg = kbSummary().collections ?? {};
    return {
      from_summary: true,
      rows: Object.values(defs).map((def) => ({
        ...def,
        members: [],
        public_entries: [],
        members_total: agg[def.id]?.members_total ?? 0,
        publishable_total: agg[def.id]?.publishable_total ?? 0,
        by_schema: agg[def.id]?.by_schema ?? {},
        by_container: agg[def.id]?.by_container ?? {},
        href: `collections/${def.id}/`,
      })),
    };
  }

  const objects = loadKb();
  const containers = sourceContainers(objects);
  const byObject = new Map();
  for (const c of containers)
    for (const obj of c.objects) byObject.set(obj.id, c.id);
  const containerOf = (id) => byObject.get(id) ?? "unattributed";
  const pub = new Set(publishableKb(objects).map((obj) => obj.id));

  return {
    from_summary: false,
    rows: Object.values(defs).map((def) => {
      const members = collectionMembers(def, objects, containerOf);
      const by_schema = {},
        by_container = {};
      for (const m of members) {
        by_schema[m.schema] = (by_schema[m.schema] ?? 0) + 1;
        const c = containerOf(m.id);
        by_container[c] = (by_container[c] ?? 0) + 1;
      }
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
    }),
  };
}
