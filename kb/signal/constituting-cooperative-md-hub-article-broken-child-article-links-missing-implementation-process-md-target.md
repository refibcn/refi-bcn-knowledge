---
title: constituting-cooperative.md hub article — broken child-article links + missing implementation-process.md target
type: signal
signal_type: content
affected_layer: layer-3-resource
interpretation: This hub article's seven "Read the full article" links all use a relative path of the form "articles/<slug>.md", implying an "articles/" subfolder beneath article-cooperative/ that does not exist — so every link 404s as written, even though five of the seven target files DO exist as direct siblings in the same directory (hybrid-model-bridging-web3-social-economy.md, why-cooperative-structure.md, dao-mechanisms.md, membership-stakeholders.md, resource-flows-financial-management.md). Two targets (strategic-lines-action.md, bioregional-financing-facility.md) are not present under article-cooperative/ at all, though materially equivalent content exists elsewhere in the corpus under different filenames/paths (content/01-about/strategic-lines.md; content/03-wip/articles/ article-bioregionalism/bioregional-financing-facility.md). The eighth link, "implementation-process.md," does not exist anywhere in the corpus at the batch SHA — the 8-step process it would have expanded on survives only as the summary in this hub article (captured in the accompanying encyclopedia-entry candidate). This is consistent with the corpus's general 2024–2025 WIP-vintage state (per the stale-content discipline rule) rather than a single one-off typo, given the consistent wrong-prefix pattern across all seven links.
proposed_intervention: review
domain: knowledge-infrastructure
high_risk: false
maturity: raw
ai_assisted: true
source_lineage: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/03-wip/articles/article-cooperative/constituting-cooperative.md
provenance:
  origin: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/03-wip/articles/article-cooperative/constituting-cooperative.md
  surfaced_by: KMS Batch 1 — old-KB reprocessing (2026-07-20)
  transformation: inferred
  authorship: ai-assisted
work_order: wo-832863b57d74
---

Verified by listing content/03-wip/articles/article-cooperative/ at the batch SHA: it contains constituting-cooperative.md plus exactly the five sibling files named above, with no "articles/" subdirectory. Flagging for review rather than "fixing" the links per the stale-content discipline rule — a steward should decide whether to correct the relative paths, retire this hub page, or let the child WIP articles supersede it once each has its own accepted ingest coverage.
