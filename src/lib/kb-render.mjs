// Server-side render helpers shared by the public commons pages and the
// internal review page's frontmatter. Pure string builders — no DOM.
// COLORS: dataviz-validated on paper #fbf9f3 (all 6 checks pass; fixed assignment).
export const COLORS = {
  "claim-evidence": "#C92637",
  "concept-lineage": "#7B3B6E",
  "encyclopedia-entry": "#3A6B24",
  "public-use-boundary": "#B08000",
  resource: "#426EAF",
  signal: "#C96A2B",
  "source-system": "#0A9B8E",
};

export const TYPE_INFO = {
  resource:
    "Concrete assets — articles, guides, funding rounds, tools, organizations.",
  signal:
    "Time-bound observations — status changes, elapsed timelines, open questions.",
  "encyclopedia-entry":
    "Stable reference entries — actors, places, concepts of the territory.",
  "claim-evidence":
    "Claims with their evidence trail — kept separate from settled fact.",
  "concept-lineage":
    "How ideas evolved — the intellectual history behind the work.",
  "public-use-boundary":
    "Governance metadata — what may publish and under which conditions.",
  "source-system": "The living systems this knowledge is drawn from.",
};

export const escHtml = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

export function tagRowHtml(o) {
  const tag = (body, cls = "") => `<span class="tag${cls}">${body}</span>`;
  return (
    `<div class="tags">` +
    tag(
      `<span class="dot" style="background:${COLORS[o.schema]}"></span>${o.schema}`,
    ) +
    (o.subtype && o.subtype !== o.schema ? tag(escHtml(o.subtype)) : "") +
    (o.domain ? tag(escHtml(o.domain)) : "") +
    tag(escHtml(o.maturity)) +
    (o.high_risk ? tag("⚠ high-risk", " warn") : "") +
    `</div>`
  );
}

export function fieldHtml(label, v, mono = false) {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "";
  const body = Array.isArray(v)
    ? v
        .map((x) =>
          typeof x === "object" ? JSON.stringify(x, null, 2) : String(x),
        )
        .join("\n")
    : typeof v === "object"
      ? JSON.stringify(v, null, 2)
      : String(v);
  return `<dt>${escHtml(label)}</dt><dd class="${mono ? "mono" : ""}">${escHtml(body)}</dd>`;
}

// Per-schema field order for the reader (public page + internal app share it).
export const FIELD_ORDER = {
  "claim-evidence": ["claim", "evidence", "interpretation", "uncertainty"],
  "concept-lineage": [
    "short_description",
    "source_traditions",
    "tensions",
    "risks_of_flattening",
    "toolkit_usage",
  ],
  signal: ["interpretation", "proposed_intervention", "signal_type"],
  "encyclopedia-entry": ["summary", "known_tensions", "audience", "page_type"],
  resource: ["summary", "notes", "resource_type", "link_status"],
  "source-system": ["what_it_curates", "url", "update_rhythm"],
  "public-use-boundary": ["consent_note", "tier", "review_type"],
};
const LABELS = {
  short_description: "description",
  proposed_intervention: "proposed intervention",
  known_tensions: "known tensions",
  risks_of_flattening: "risks of flattening",
  source_traditions: "source traditions",
  toolkit_usage: "toolkit usage",
  resource_type: "type",
  signal_type: "type",
  page_type: "type",
  link_status: "link status",
  update_rhythm: "update rhythm",
  review_type: "review type",
  what_it_curates: "what it curates",
  work_order: "work order",
};
export const fieldLabel = (k) => LABELS[k] || k.replace(/_/g, " ");

// Full typed body for one object: ordered primary fields → provenance → the rest.
// `related_concepts` is omitted (rendered separately as connections).
export function typedFieldsHtml(o) {
  const r = o.raw;
  const order = FIELD_ORDER[o.schema] || ["summary"];
  const shown = new Set([
    "title",
    "provenance",
    "related_concepts",
    "type",
    "publish",
  ]);
  let html = "";
  for (const k of order) {
    if (r[k] != null && r[k] !== "") {
      html += fieldHtml(fieldLabel(k), r[k], false);
      shown.add(k);
    }
  }
  if (r.provenance) html += fieldHtml("provenance", r.provenance, true);
  for (const k of Object.keys(r)) {
    if (shown.has(k)) continue;
    html += fieldHtml(fieldLabel(k), r[k], typeof r[k] === "object");
  }
  return html;
}
