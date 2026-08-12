---
title: IDRA page — stale-verification mismatch & templated boilerplate (content signal)
type: signal
signal_type: content
affected_layer: layer-3-resource-graph
interpretation: 'Two content-quality issues on the IDRA source page: (1) the frontmatter claims last_verified: 2026-05-06, but the page''s own footer reads "Reference compiled from https://idrabcn.com/ - Last updated: 2024" — the two dates conflict and the 2026-05-06 verification date should not be trusted at face value without a re-check against idrabcn.com. (2) Sections like "Key Concepts" (Urban Research, Social and Ecological Justice, Economic Democracy, Just Transition), "Values & Principles", and "Innovation Areas" read as generic templated definitions rather than content specific to IDRA — this "Projects & Organizations" corpus appears to reuse the same template/definition boilerplate across multiple Catalunya entity pages (recurring corpus-level theme: templated boilerplate risks near-duplicate encyclopedia-entry candidates if lifted verbatim from every entity page using the same template). Held out of the resource objects rather than promoted to encyclopedia-entry.'
proposed_intervention: review
domain: regenerant-catalunya
maturity: raw
ai_assisted: true
source_lineage: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/bioregional/catalunya/Projects%20&%20Organizations/IDRA%20Institut%20de%20Recerca%20Urbana%20de%20Barcelona.md
provenance:
  origin: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/bioregional/catalunya/Projects%20&%20Organizations/IDRA%20Institut%20de%20Recerca%20Urbana%20de%20Barcelona.md
  surfaced_by: KMS Batch 1 — old-KB reprocessing (2026-07-20)
  transformation: inferred
  authorship: ai-assisted
work_order: wo-7df55367c8a9
---

theme: docs/kms/FRAMEWORK-FEEDBACK.md — "Catalunya 'Projects & Organizations' template reuses generic Key-Concepts/Values boilerplate across entity pages; watch for near-duplicate encyclopedia-entry candidates across the batch." No prior canonical signal found in data/kb/signal.yaml (not yet populated locally) or ../refi-dao-os/data/kb/signal.yaml at ingest time; flagging here for the operator to aggregate/dedupe against other Catalunya-entity work orders in this batch.
