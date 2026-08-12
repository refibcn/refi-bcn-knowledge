---
title: 'Content review: BFF case-study vs sibling BioFi case-study files'
type: signal
signal_type: content
affected_layer: layer-2-encyclopedia
interpretation: This file ("What is a BFF?.md") sits in the same directory as several other BioFi/BFF case-study files (e.g. "BioFi.md", "What is BioFi?.md") being ingested as sibling work orders in the same batch. All are condensed "Key Messages from the Book" digests of the same 2024 BioFi book, so there is a real risk of the encyclopedia layer ending up with several overlapping framework/concept entries (BFF, BioFi, Bioregional Trust, etc.) that should eventually be cross-linked or partially merged rather than read as independent frameworks.
proposed_intervention: review
domain: bioregional-finance
high_risk: false
maturity: raw
ai_assisted: true
source_lineage: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/bioregional/case-studies/What%20is%20a%20BFF?.md
provenance:
  origin: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/bioregional/case-studies/What%20is%20a%20BFF?.md
  surfaced_by: KMS Batch 1 — old-KB reprocessing (2026-07-20)
  transformation: inferred
  authorship: ai-assisted
work_order: wo-337fa4c9d735
---

Cross-work-order observation, not a defect in this file specifically; raised here because this WO is processed in isolation from its siblings and a reviewer stitching the batch together should check for redundant framework entries across the case-studies/ directory before promotion.
