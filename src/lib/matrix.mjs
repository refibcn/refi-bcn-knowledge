// The home matrix: layers × containers (spec DC-M1..M9). Definitions in
// src/data/matrix.yaml (asserted cells), computation here. Rules:
//   - computed beats asserted (location from the card, origin from the
//     disposition, store/review from the row) — the YAML fills only gaps;
//   - absent renders null (the page's "—"), never an invented value;
//   - an unknown defs id throws; an un-listed source-role row is APPENDED as a
//     bare computed column so a new card is never invisible (DC-1);
//   - high_risk_count without unresolved_high_risk throws — absent is a claim
//     about the build, 0 is a claim about the corpus (archiveReady doctrine).
//
// Dual-path for free: every number comes from sourcesViewModel(), which already
// resolves the workspace store vs the committed aggregate behind one row shape.
// This module reads no store of its own, and must not start — see the
// "one row shape, both paths" note in sources.mjs.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { z } from "zod";
import { sourcesViewModel } from "./sources.mjs";

// Repo-root walk, same as kb.mjs — see its header before "simplifying" this.
function findRepoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "package.json"))) {
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error("matrix.mjs: no package.json above this module");
    dir = parent;
  }
  return dir;
}
export const MATRIX_FILE = resolve(
  findRepoRoot(),
  "src",
  "data",
  "matrix.yaml",
);

/** The spec's eight layer rows, in render order (DC-M2). */
export const LAYERS = Object.freeze([
  { id: "location", label: "Location" },
  { id: "origin", label: "Origin" },
  { id: "ingestion", label: "Ingestion" },
  { id: "store", label: "Store" },
  { id: "ontology", label: "Ontology" },
  { id: "review", label: "Review" },
  { id: "internal", label: "Internal" },
  { id: "public", label: "Public" },
]);

// hrefs in this file are instance-relative by contract (pages wrap them in
// withBase()); externals are text-only cells. `.strict()` everywhere for the
// same reason collections.mjs documents: zod silently strips unknown keys, and
// a typo'd field name must fail the build, not quietly drop an assertion.
const CellSchema = z
  .object({ text: z.string().min(1), href: z.string().optional() })
  .strict();
const ColumnDefSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    label: z.string().min(1),
    location: z.string().optional(),
    origin_note: z.string().optional(),
    ingestion: z.string().optional(),
    ontology: z.string().optional(),
    ontology_ref: z.string().optional(),
    review_note: z.string().optional(),
    internal: CellSchema.optional(),
    public: CellSchema.optional(),
    gate: z.string().optional(),
    owner: z.string().optional(),
    loop: z.string().optional(),
  })
  .strict();
const MatrixDefsSchema = z
  .object({
    as_of: z.string().min(1),
    columns: z.array(ColumnDefSchema).min(1),
  })
  .strict();

/** Validated defs. Throws with the offending column named. */
export function parseMatrixDefs(doc) {
  try {
    return MatrixDefsSchema.parse(doc);
  } catch (e) {
    if (!(e instanceof z.ZodError)) throw e;
    throw new Error(
      `matrix: definitions invalid — ` +
        e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
}

export function loadMatrixDefs(file = MATRIX_FILE) {
  if (!existsSync(file))
    throw new Error(
      `matrix.mjs: missing ${file} — the hand-authored matrix definitions.`,
    );
  return parseMatrixDefs(yaml.load(readFileSync(file, "utf8")));
}

const text = (t, href) => (t ? { text: t, ...(href ? { href } : {}) } : null);

/** One real (carded) column. `r` is a sourcesViewModel row — card already flat. */
function realColumn(def, r) {
  const d = r.disposition;
  if ((r.high_risk_count ?? 0) > 0 && r.unresolved_high_risk === undefined)
    throw new Error(
      `matrix: ${r.id} has high_risk_count ${r.high_risk_count} but no unresolved_high_risk — refusing to understate`,
    );
  const raw = r.by_maturity?.raw ?? 0;
  const unresolved = r.unresolved_high_risk ?? 0;
  const review =
    raw > 0
      ? text(
          `${raw} raw${unresolved > 0 ? ` · ${unresolved} high-risk unresolved` : ""}`,
        )
      : text(def.review_note);
  const origin =
    d?.applicable && d.files_total
      ? text(`${d.files_total} files`)
      : text(
          def.origin_note ??
            d?.reason ??
            (d === null ? "not yet measured" : undefined),
        );
  // The disposition line is computed independently of the asserted mechanism
  // text, because the two are separate claims and either can exist alone: a
  // bare computed column (no defs entry) still has real numbers to show, and a
  // container where files are the wrong unit still has a mechanism to name. So
  // an ingestion cell carries BOTH keys whenever it exists, and either may be
  // null — unlike the other cells, whose `text` is always a string.
  const detail =
    d?.applicable && d.files_total
      ? `${d.ingested} ingested · ${d.merged} merged · ${d.excluded} excluded · ${d.pending} pending`
      : null;
  const ingestion =
    def.ingestion || detail ? { text: def.ingestion ?? null, detail } : null;
  return {
    id: r.id,
    label: def.label ?? r.title,
    href: r.href,
    steward: r.card?.steward ?? null,
    planned: false,
    gate: def.gate ?? null,
    owner: def.owner ?? null,
    loop: def.loop ?? null,
    cells: {
      location: r.card?.corpus_path
        ? text(r.card.corpus_path, r.card.url)
        : text(def.location),
      origin,
      ingestion,
      store:
        r.objects_total > 0 ? text(`${r.objects_total} typed objects`) : null,
      ontology: def.ontology
        ? {
            text: def.ontology,
            ...(def.ontology_ref ? { ref: def.ontology_ref } : {}),
          }
        : null,
      review,
      internal: def.internal ?? null,
      public: def.public ?? null,
    },
  };
}

/** One planned (card-less) column — asserted cells only; store/review stay null
 *  unless the defs say otherwise, because nothing has been ingested. */
function plannedColumn(def, p) {
  return {
    id: p.id,
    label: def.label ?? p.title,
    href: null,
    steward: null,
    planned: true,
    gate: def.gate ?? null,
    owner: def.owner ?? null,
    loop: def.loop ?? null,
    cells: {
      location: text(def.location),
      origin: text(def.origin_note),
      ingestion: def.ingestion ? { text: def.ingestion, detail: null } : null,
      store: null,
      ontology: def.ontology
        ? {
            text: def.ontology,
            ...(def.ontology_ref ? { ref: def.ontology_ref } : {}),
          }
        : null,
      review: text(def.review_note),
      internal: def.internal ?? null,
      public: def.public ?? null,
    },
  };
}

/** A source-role row with no defs entry: bare computed column. Appended, never
 *  dropped — a new card must be visible before it is described (DC-1). */
function bareColumn(r) {
  return realColumn({ id: r.id, label: r.title }, r);
}

/**
 * @param {{defs: any, rows: any[], planned: readonly any[]}} args
 * @returns {{columns: any[], footnote: {id: string, title: string, role: string, href: string}[], asOf: string}}
 */
export function assembleMatrix({ defs, rows, planned }) {
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const plannedById = new Map(planned.map((p) => [p.id, p]));
  const listed = new Set(defs.columns.map((c) => c.id));
  const columns = defs.columns.map((def) => {
    const r = rowById.get(def.id);
    if (r) return realColumn(def, r);
    const p = plannedById.get(def.id);
    if (p) return plannedColumn(def, p);
    throw new Error(
      `matrix: column "${def.id}" matches no source container and no planned source`,
    );
  });
  for (const r of rows)
    if (r.role === "source" && !listed.has(r.id)) columns.push(bareColumn(r));
  // `unattributed` is excluded as well as the non-source roles: it is the canary
  // bucket for objects no container claimed (kb.mjs UNATTRIBUTED), has no card,
  // and so arrives with role "unknown" — listing it here would present a tally
  // as if it were a repo alongside the self and render-target ones.
  const footnote = rows
    .filter((r) => r.role !== "source" && r.id !== "unattributed")
    .map((r) => ({ id: r.id, title: r.title, role: r.role, href: r.href }));
  return { columns, footnote, asOf: defs.as_of };
}

/** The page-facing wrapper: live rows + planned + the committed YAML. Dual-path
 *  for free — sourcesViewModel resolves its own path, and the defs are a
 *  committed instance file. */
export function matrixViewModel() {
  const src = sourcesViewModel();
  return assembleMatrix({
    defs: loadMatrixDefs(),
    rows: src.rows,
    planned: src.planned,
  });
}
