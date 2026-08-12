---
title: Quadratic Funding (Gitcoin grants matching)
type: encyclopedia-entry
page_type: concept
summary: 'A crowdfunding-democratization mechanism, as described in the old-KB Gitcoin page: individual contributions are amplified by a matching pool so that many small donations carry outsized weight relative to a few large ones, leveling the playing field for projects seeking funding. Deployed by Gitcoin across its Grants rounds; paired with Web3-based identity verification (Gitcoin Passport) to defend against Sybil attacks that would otherwise let one funder split into many "small" donors to game the matching weighting.'
audience: ReFi BCN members evaluating Web3 public-goods funding mechanisms for cooperative/commons funding design
known_tensions:
  - the mechanism's fairness depends on Sybil resistance holding — the source itself names this as a "potential vulnerability" requiring an added identity layer (Gitcoin Passport), not something quadratic funding solves on its own
  - the source presents quadratic funding uncritically as democratizing; it does not discuss known critiques (e.g. collusion/bribery risk, matching-pool capital concentration, plutocratic funders steering "public" rounds)
related_concepts:
  - sybil-resistance
  - public-goods-funding
related_resources:
  - gitcoin
  - gitcoin-passport
domain: web3-funding-mechanisms
maturity: raw
ai_assisted: true
source_lineage: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/global/global/Gitcoin.md
provenance:
  origin: https://github.com/refibcn/ReFi-Barcelona/blob/fe87706/content/02-ecosystem/global/global/Gitcoin.md
  surfaced_by: KMS Batch 1 — old-KB reprocessing (2026-07-20)
  transformation: summarized
  authorship: ai-assisted
work_order: wo-053f700dee67
---

The old-KB source describes quadratic funding only through Gitcoin's own deployment of it — no lineage tracing (e.g. Buterin/Hitzig/Weyl "Liberal Radicalism" origin) is present in this file, so no concept-lineage object is emitted here (a richer concept-lineage for this concept already exists in the refi-dao-os reference store; title kept identical to this entry's title so the two dedup as the same real-world concept rather than fork). If bcn wants its own concept-lineage, it should be built from a source that actually states the lineage.
