---
title: 'Old-KB domain mistag: CGT Catalunya tagged bioregional-finance'
type: signal
maturity: raw
ai_assisted: true
signal_type: ontology
affected_layer: resource frontmatter (domain field)
interpretation: 'The old-KB entity page for Confederació General de Treball de Catalunya (CGT) — a libertarian labor union / anarcho-syndicalist federation with focus_areas [labor-union, anarcho-syndicalism, worker-rights, social-action] and no finance-sector activity described anywhere in the body — carries `domain: bioregional-finance` in its frontmatter. This looks like a mechanical default applied across the `bioregional/catalunya/Projects & Organizations/` folder during the original ingest rather than a considered tag; it risks surfacing a labor union under finance-domain queries/filters.'
proposed_intervention: review
domain: bioregional-catalunya
source_lineage: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/bioregional/catalunya/Projects%20%26%20Organizations/Confederaci%C3%B3%20General%20de%20Treball%20de%20Catalunya%20(CGT).md
provenance:
  origin: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/bioregional/catalunya/Projects%20%26%20Organizations/Confederaci%C3%B3%20General%20de%20Treball%20de%20Catalunya%20(CGT).md
  surfaced_by: KMS Batch 1 — old-KB reprocessing (2026-07-20)
  transformation: inferred
  authorship: ai-assisted
work_order: wo-d6c1715bdc7b
---

Companion signal to the "Confederació General de Treball de Catalunya (CGT)" resource candidate in this same work order; recommend a reviewer check whether other entity pages in the same `bioregional/catalunya/Projects & Organizations/` folder share this domain mistag before correcting in bulk.
