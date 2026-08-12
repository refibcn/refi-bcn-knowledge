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

// A cell's `href` comes in two kinds and the page MUST tell them apart:
// instance-relative (wrapped in withBase()) and absolute-external (used as-is,
// and worth a target="_blank" rel="noopener", the way sources.astro already
// renders a card's URL). `cell()` marks the second kind `external: true`;
// without that marker withBase() would emit "/https://github.com/…".
// Hand-authored hrefs are relative BY SCHEMA — an absolute one in the YAML is
// rejected below rather than silently marked, so "no YAML cell is external"
// stays an invariant instead of an accident of the current file.
//
// `.strict()` everywhere for the same reason collections.mjs documents: zod
// silently strips unknown keys, so a typo'd `hef:` would drop a link with no
// error anywhere. `.min(1)` on every optional string for this file's own
// doctrine: absent and empty are different claims, and `ingestion: ""` must not
// quietly become the same null cell as an omitted `ingestion:`.
/** True for an href the page must NOT put through withBase(): anything carrying
 *  a scheme (`https:`, `mailto:`, `ipfs:`) or protocol-relative (`//host`).
 *
 *  ONE predicate, used in both directions — the schema rejects these in
 *  hand-authored cells, `cell()` flags them on a card's URL — so the two can
 *  never disagree about what "absolute" means. Leading whitespace is consumed
 *  deliberately: `" https://x"` must not read as relative to the schema and as
 *  non-external to `cell()` at the same time, which is a fail-open crack in an
 *  otherwise fail-closed invariant. */
const isAbsoluteHref = (h) => /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(h);

const relativeHref = z
  .string()
  .min(1)
  .refine((h) => !isAbsoluteHref(h), {
    message:
      "must be instance-relative (pages wrap it in withBase()); put an external link in the cell text",
  });
const CellSchema = z
  .object({ text: z.string().min(1), href: relativeHref.optional() })
  .strict();
const ColumnDefSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    label: z.string().min(1),
    location: z.string().min(1).optional(),
    origin_note: z.string().min(1).optional(),
    ingestion: z.string().min(1).optional(),
    ontology: z.string().min(1).optional(),
    ontology_ref: z.string().min(1).optional(),
    review_note: z.string().min(1).optional(),
    internal: CellSchema.optional(),
    public: CellSchema.optional(),
    gate: z.string().min(1).optional(),
    owner: z.string().min(1).optional(),
    loop: z.string().min(1).optional(),
  })
  .strict();
// The envelope only; columns are parsed one at a time below so the error can
// name the offending column rather than an array index.
const MatrixEnvelopeSchema = z
  .object({
    // Dated, not free text: `as_of: soon` would render as a freshness claim.
    as_of: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)"),
    columns: z.array(z.unknown()).min(1),
  })
  .strict();

/** True IFF `v` is a non-array, non-null object. An empty YAML file parses to
 *  `undefined`, which would otherwise reach zod and produce `: Required` — an
 *  empty path segment naming nothing. collections.mjs guards this the same way. */
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Name the offending location AND the file. A bare ZodError with path
 *  ["label"] tells an operator nothing when the file holds seven columns —
 *  the lesson collections.mjs records at its own parse site. */
function parseOrThrow(schema, value, where) {
  try {
    return schema.parse(value);
  } catch (e) {
    if (!(e instanceof z.ZodError)) throw e;
    throw new Error(
      `${where} — ` +
        e.issues
          .map(
            (i) =>
              `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`,
          )
          .join("; "),
    );
  }
}

/** Validated defs. Throws with the offending column and the file named. */
export function parseMatrixDefs(doc, file = MATRIX_FILE) {
  if (!isPlainObject(doc))
    throw new Error(
      `matrix: ${file} must hold a mapping with \`as_of\` and \`columns\` — got ${JSON.stringify(doc) ?? typeof doc}`,
    );
  const envelope = parseOrThrow(
    MatrixEnvelopeSchema,
    doc,
    `matrix: ${file} is invalid`,
  );
  const columns = envelope.columns.map((raw, i) =>
    parseOrThrow(
      ColumnDefSchema,
      raw,
      `matrix: column ${
        isPlainObject(raw) && typeof raw.id === "string"
          ? `"${raw.id}"`
          : `#${i + 1}`
      } in ${file} is invalid`,
    ),
  );
  // The ordered list is deliberate — column order is semantic — but it gives up
  // the uniqueness a keyed map gets for free, so check it explicitly. Two
  // entries with one id would render the container twice and let the second
  // silently shadow the first for anyone reading by id.
  const seen = new Set();
  for (const c of columns) {
    if (seen.has(c.id))
      throw new Error(`matrix: duplicate column id "${c.id}" in ${file}`);
    seen.add(c.id);
  }
  return { as_of: envelope.as_of, columns };
}

export function loadMatrixDefs(file = MATRIX_FILE) {
  if (!existsSync(file))
    throw new Error(
      `matrix.mjs: missing ${file} — the hand-authored matrix definitions.`,
    );
  return parseMatrixDefs(yaml.load(readFileSync(file, "utf8")), file);
}

/** One cell, or null when there is nothing to say — the page's "—". An absolute
 *  href is flagged `external` (see the CellSchema note above). */
const cell = (text, href) =>
  text
    ? {
        text,
        ...(href
          ? { href, ...(isAbsoluteHref(href) ? { external: true } : {}) }
          : {}),
      }
    : null;

/** One carded column. `r` is a sourcesViewModel row — card already flat. */
function cardedColumn(def, r) {
  const d = r.disposition;
  // `== null`, not `=== undefined`: this crosses a JSON boundary (the committed
  // kb-summary) where an explicit null is representable, and a null slipping
  // past the guard would reach `?? 0` and understate exactly what the guard
  // exists to prevent. derive-kb-summary.mjs already refuses to emit one; this
  // is the belt to that pair of braces.
  if ((r.high_risk_count ?? 0) > 0 && r.unresolved_high_risk == null)
    throw new Error(
      `matrix: ${r.id} has high_risk_count ${r.high_risk_count} but no unresolved_high_risk — refusing to understate`,
    );
  const raw = r.by_maturity?.raw ?? 0;
  const unresolved = r.unresolved_high_risk ?? 0;
  const review =
    raw > 0
      ? cell(
          `${raw} raw${unresolved > 0 ? ` · ${unresolved} high-risk unresolved` : ""}`,
        )
      : cell(def.review_note);
  const origin =
    d?.applicable && d.files_total
      ? cell(`${d.files_total} files`)
      : cell(
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
        ? cell(r.card.corpus_path, r.card.url)
        : cell(def.location),
      origin,
      ingestion,
      store:
        r.objects_total > 0 ? cell(`${r.objects_total} typed objects`) : null,
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

/** One planned (card-less) column: every cell is asserted, because there is no
 *  card to compute from. `store` is always null — nothing has been ingested, and
 *  the defs deliberately have no way to claim otherwise. `review` and the rest
 *  render only what the YAML states (`review_note` for a queue that exists
 *  outside the store, e.g. the research agent's candidates on serverito). */
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
      location: cell(def.location),
      origin: cell(def.origin_note),
      ingestion: def.ingestion ? { text: def.ingestion, detail: null } : null,
      store: null,
      ontology: def.ontology
        ? {
            text: def.ontology,
            ...(def.ontology_ref ? { ref: def.ontology_ref } : {}),
          }
        : null,
      review: cell(def.review_note),
      internal: def.internal ?? null,
      public: def.public ?? null,
    },
  };
}

/** A source-role row with no defs entry: bare computed column. Appended, never
 *  dropped — a new card must be visible before it is described (DC-1). */
function bareColumn(r) {
  return cardedColumn({ id: r.id, label: r.title }, r);
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
    if (r) return cardedColumn(def, r);
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
