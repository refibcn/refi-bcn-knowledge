---
title: ReFi Ecosystem index — coverage points to dedicated entity files, not restated here
type: signal
signal_type: content
affected_layer: layer-3-resource-graph
interpretation: '"ReFi Ecosystem.md" is a pure hub/index page: every named entity or sub-concept it introduces (What is ReFi, The State of ReFi, Web3 Funding Mechanisms, Gitcoin, RetroPGF, Giveth, ReFi DAO, Blockchain Ecosystems, Ethereum, Celo, Optimism) already has its own dedicated file in the same corpus folder (content/02-ecosystem/global/global/). This work order''s candidates deliberately do not re-mint resource objects for those entities to avoid duplicate/competing ingestion — each should be (or already is) captured by its own work order against its own source file.'
proposed_intervention: route
domain: refi-ecosystem
maturity: raw
ai_assisted: true
source_lineage: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/global/global/ReFi%20Ecosystem.md
provenance:
  origin: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/global/global/ReFi%20Ecosystem.md
  surfaced_by: KMS Batch 1 — old-KB reprocessing (2026-07-20)
  transformation: inferred
  authorship: ai-assisted
work_order: wo-e3f218bf64c7
---

Route: at store/reconciliation time, confirm each linked entity's own work order lands its own resource/encyclopedia-entry object; then wire this index's related_resources/related_concepts (see 01-encyclopedia-entry.yaml) to the resulting slugs.
