# Knowledge instance — Development Feedback

> **Live:** https://knowledge.refibcn.cat
> **Surfaces:** [/knowledge](https://knowledge.refibcn.cat/knowledge/) (public KB) · [/sources](https://knowledge.refibcn.cat/sources/) (source containers) · [/atlas](https://knowledge.refibcn.cat/atlas/) (Catalunya maps) · directory (Notion-CRM feed) · [/review](https://knowledge.refibcn.cat/review) (internal lens, password-gated)
> **Repository:** https://github.com/refibcn/refi-bcn-knowledge
> **All instances:** https://refibcn.github.io/versions/ (development hub)

This is the feedback surface for the knowledge instance — the same mechanism as the
website's [`DEVELOPMENT.md`](https://github.com/refibcn/refibcn.github.io/blob/main/docs/DEVELOPMENT.md):
walk the live surfaces, file section-level notes here, tag your name, and they get
batch-processed rather than lost in chat.

---

## Current state (v1.0 — initial, 2026-08-10)

- First deploy of the standalone instance: **6 source containers · 416 knowledge objects · 0 unattributed**. The old KB reads 272 files → 88 ingested · 9 merged · 175 excluded · 0 pending.
- **Publishing is fail-closed by design**: zero public objects until review promotes them. The public build carries the leak guard; review happens through the password-gated lens.
- **Naming (`BD-2026-060`):** "knowledge commons" is dropped as a working label — this instance is **Regenerant Catalunya**, named directly. What the *container* above the public sub-scopes is called is still open and gates any route/domain renames.
- The consolidated ingestion batch (`BD-2026-065` — old KB + Catalonia map + Telegram history, exception-based review) lands here when it runs.

---

## How to Contribute

1. **Review the live surfaces** at the links above
2. **Add your feedback** in the sections below — edit this file directly on GitHub (pencil icon)
3. **Tag your comments** with your name/handle
4. **Prioritize** if possible (🔴 Critical, 🟡 Important, 🟢 Nice to have)

---

## General Impressions

> First reactions to the instance as a whole.

-
-

---

## Knowledge base & typing

> The schemas, the typed objects, what's in review vs excluded. Does the typing carry
> what you'd need? Where do the categories fight Giulio's CRM ontology instead of
> composing with it?

-
-

---

## Sources & attribution

> The /sources containers — is the provenance model legible? Anything showing up
> unattributed or in the wrong container?

-
-

---

## Atlas & maps

> The Catalunya map surfaces. Note: the Giulio-map ↔ /atlas convergence question is
> still open (260811 sync) — layout/legend/data feedback welcome regardless.

-
-

---

## Directory (CRM feed)

> The Notion-CRM-fed directory pages — coverage, fields, gallery behaviour.

-
-

---

## Navigation & UX

> Moving between knowledge, sources, atlas and directory — does it hold together as
> one instance?

-
-

---

## Bugs & Issues

| Issue | Where (URL) | Browser/Device | Reporter |
|-------|-------------|----------------|----------|
| | | | |

---

## Questions for Discussion

- [ ] **Container naming** — `BD-2026-060` names the instances (Regenerant Catalunya · Bioregioning) but not the container above the sub-scopes; gates renaming routes/domains (`task-260806-luiz-propagate-naming`).
- [ ] **First promotions** — which Catalonia-scoped objects go public first, once the review loop runs?
- [ ] **Ontology reconciliation** — old-KB categories vs Giulio's CRM ontology (`BD-2026-047`): compromise per collision, or split into distinct things?
- [ ]

---

## Decisions Made

| Decision | Date | Context |
|----------|------|---------|
| "Knowledge commons" dropped as working name; instances named directly (Regenerant Catalunya · Bioregioning) | 2026-08-06 | `BD-2026-060`, work session |
| One consolidated ingestion batch, exception-based review via agent flags | 2026-08-06 | `BD-2026-065`, work session |
| One internal broad base → curated public sub-scopes; Catalonia first public artifact | 2026-07-21 | D6/D7, ops sync |
| Instance shipped standalone at knowledge.refibcn.cat; website's /commons + /atlas became redirect stubs | 2026-08-10 | convergence session |

---

*Add your name when you file feedback.*

**Contributors:**
