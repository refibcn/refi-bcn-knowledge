---
title: BioFi Case Studies page is an external PDF link-index, not cached content
type: signal
signal_type: content
affected_layer: layer-3-resource-graph
interpretation: The page lists 12 BioFi case studies as a title plus a hashed Webflow-CDN PDF download link only — no summaries, dates, or authorship captured on-page. It is explicitly a mirror of BioFi's external "resource garden" (https://www.biofi.earth/resource-garden). The hashed CDN URLs are fragile third-party asset IDs, prone to link rot if BioFi's site is restructured. None of the 12 linked PDFs were fetched or verified by this ingest.
proposed_intervention: review
domain: bioregional-finance
high_risk: true
maturity: raw
ai_assisted: true
source_lineage: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/bioregional/case-studies/BioFi%20Case%20Studies.md
provenance:
  origin: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/bioregional/case-studies/BioFi%20Case%20Studies.md
  surfaced_by: KMS Batch 1 — old-KB reprocessing (2026-07-20)
  transformation: inferred
  authorship: ai-assisted
work_order: wo-09f73e790a92
---

Recommend: (a) evaluate BioFi's resource garden as a candidate external source-system if ReFi BCN keeps citing it, (b) fetch and verify the CDN links before promoting any of the 3 case-study resource objects emitted from this page past raw, since the carbon/MRV and funding-recommendation claims in those PDFs are unverified third-party framing (see the accompanying public-use-boundary). Stale-content note: this corpus is 2024-2025 vintage; BioFi's resource-garden contents may have moved or changed since.
