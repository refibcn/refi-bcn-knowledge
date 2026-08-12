# refi-bcn-knowledge — the ReFi BCN knowledge instance

The knowledge instance for ReFi Barcelona: an Astro 5 static site that publishes the
organization's knowledge base, its directory of organizations and programs, and a
Catalunya atlas.

This is instance 2 of a three-instance model:

| Instance               | Repo           | Scope                                                 |
| ---------------------- | -------------- | ----------------------------------------------------- |
| Website                | `refibcn-site` | refibcn.cat — marketing / public front door           |
| **Knowledge instance** | **this repo**  | knowledge.refibcn.cat — knowledge + atlas + directory |
| Bioregioning           | separate       | Wider bioregional programme                           |

### A note on naming (BD-2026-060)

"Knowledge commons" was **dropped as a working name** on 2026-08-06: the label was
being used for two different instances, and it overclaims — none of this is a commons
yet, it is the team's own work. Stage 1 of the rename (this repo's routes, labels and
docs) is applied. What is deliberately **not** renamed:

- **URLs.** This instance ships at `knowledge.refibcn.cat`; `regenerant.refibcn.cat`
  keeps serving the Quartz program site, separately. No takeover, no repo rename.
- **The repo name** (`refi-bcn-knowledge`) and the `refibcn/commons-review` artifact
  bucket — invisible plumbing, renaming buys nothing.
- **The `COMMONS_REVIEW` env var** — the internal-build switch, referenced by the
  deploy workflow.

The instance name (Regenerant Catalunya) lands in `src/data/site.yaml` `name` and the
`index.astro` hero **once the sync ratifies what the container above the sub-scopes is
called** — BD-2026-060 named the sub-scopes without naming the container. Until then
the chrome carries functional labels only.

## Two feeds

1. **The typed store `kb/`** — in this repo: one markdown file per object at
   `kb/<schema>/<slug>.md`. Frontmatter holds the object's fields, the body its
   `notes`; the folder carries the schema and the filename the slug. See `kb/README.md`
   for the store contract, and the header of `scripts/migrate-kb-to-md.mjs` for the
   exact parse rule `src/lib/kb.mjs` mirrors (migrated 2026-08-12 from
   `refi-bcn-os/data/kb/*.yaml` with a 422/422 round-trip fidelity proof). Because the
   store travels with the repo, every build — dev, CI, a standalone clone — reads the
   same store; there is no fallback path.
2. **Notion CRM** — organizations, programs, events and territory records that feed the
   directory and the atlas, read through `@notionhq/client` with `NOTION_API_KEY`
   (copy `.env.example` to `.env`). The CRM registry itself stays in the refi-bcn-os
   workspace (`data/crm.yaml`) as the source of truth; Notion is the pushed mirror this
   instance reads at build time.

### One committed derivation still bridges to the workspace

The ingest **batch rosters** live in the org-os checkout
(`refi-bcn-os/docs/kms/batches/*.yaml`), which CI does not have — so the per-source
file disposition is **derived from the workspace and committed**:

| Artifact                            | Command                      | What it holds                                                           |
| ----------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `src/data/sources-disposition.json` | `npm run derive:disposition` | Per-source file disposition from `refi-bcn-os/docs/kms/batches/*.yaml`. |

**After any batch: `npm run derive:disposition`, commit the result.** It is derived
data under version control, so it goes stale silently. `npm test` pins that:
`tests/kb-sources.test.mjs` recomputes the disposition from the workspace rosters and
fails if the committed file disagrees (skipped when there is no workspace, i.e. in CI).
This is not hypothetical bookkeeping — it fired on 2026-08-10: an upstream commit added
8 files to a counted corpus, `sources-disposition.json` went stale (155 → 162 files),
and the suite went red until it was re-derived. Treat that failure mode as the
staleness guard doing its job, not as a flaky test.

**This repo still lives at `refi-bcn-os/repos/refi-bcn-knowledge/` — do not relocate
it.** `derive:disposition` reaches the workspace rosters and source cards over that
relative depth.

## Routes

The home page (`/`) is a dashboard: a status strip (objects · in review · published ·
sources · collections) plus section cards to every surface below, in working order.

| Route                                      | Audience                                              | What it is                                                                                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/knowledge`, `/knowledge/<schema>/<slug>` | Public                                                | Reviewed, publishable knowledge base pages compiled from the org-os KB engine.                                                                                                                                      |
| `/collections`, `/collections/<id>`        | Public definitions; gated entries                     | Curated sub-scopes over the store — see "Collections model" below.                                                                                                                                                  |
| `/sources`, `/sources/<id>`                | Public                                                | One row per ingested source: what it holds and how far it has been processed.                                                                                                                                       |
| `/slices`                                  | Public, not in the main nav                           | Four crosscuts over the store — domains × schemas, the review funnel, the high-risk queue, boundary tiers — plus a geography section deferred pending decision D9. Reachable from `/system` and the home dashboard. |
| `/system`                                  | Public                                                | The data layer depicted from the data itself: Feeds → Store → Curation → Surfaces bands with live counts, an authority table, and a gate inventory. No hand-drawn numbers.                                          |
| `/review`                                  | Internal only (`COMMONS_REVIEW=1`), shipped encrypted | The full internal KB app, including unreviewed content. A plain build renders a stub — see "The internal lens builds separately" below.                                                                             |
| `/atlas`                                   | Public                                                | Catalunya map — comarques and territorial context.                                                                                                                                                                  |
| `/organizations`, `/programs`, `/events`   | Public                                                | The directory — organizations, programs and events, fed from the Notion CRM.                                                                                                                                        |
| `/priorities`, `/priorities/<id>`          | Public                                                | Priority areas and the indicators tracked against them, also fed from the Notion CRM.                                                                                                                               |

### Collections model

A collection is a committed _definition_ over the store (`src/data/collections.yaml`,
zod-validated), never a copy — its membership rules (containers, domains, schemas,
explicit ids, minus excludes) are evaluated at build time. Members still render through
the existing gates: the public build shows a collection's scope and counts and lists
only the members that pass `publishableKb()` as **entries** (unpublishable members
appear as counts only), the internal build (`COMMONS_REVIEW=1`) lists every member with
review deep-links, and `scripts/verify-public-kb.mjs` independently re-checks
`dist/collections/` for leaked per-object links.

### Atlas data and assets

`/atlas` renders `src/components/CatalunyaProgramMap.astro` — MapLibre GL over
OpenFreeMap's hosted "positron" vector tiles (no API key), clamped to Catalunya.
Two things it loads from `public/`:

- `public/geo/catalunya-comarques.geojson` — the comarca boundary overlay, fetched at
  runtime via the `data-geo-url` attribute. Kept minified; see `.prettierignore`.
- `public/images/projects/*.png` — popover card images. A project without one falls
  back to a generated inline-SVG initial tile (`src/lib/initial-tile.ts`), so the set
  does not have to be complete.

Markers currently come from the static `src/data/rc-cohort.yaml` snapshot, typed by the
`cohort` collection in `src/content.config.ts`. Re-feeding them from the CRM, and the
legend taxonomy, are separate follow-on work — not part of this port.

## Commands

```bash
npm install
npm run dev       # local dev server
npm run build     # static build to dist/
npm run preview   # serve the built dist/
npm run check     # astro check (types) + prettier --check
npm run format    # prettier --write

# Committed derivation — re-run after every ingest batch
npm run derive:disposition   # → src/data/sources-disposition.json
```

`npm run build` ends in `node scripts/verify-public-kb.mjs` — a hard gate that walks the
whole of `dist/` for known raw-store canary strings and fails the build if any appear.
It is the last line of defence behind `publishableKb()`, not a substitute for it.

### The internal lens builds separately

`/review` is env-gated. A plain `astro build` renders a **stub** — the page
short-circuits on `COMMONS_REVIEW !== "1"` and no store content is read at all, so a
public deploy cannot ship the dataset even by accident. The real app is built and
encrypted by its own command:

```bash
STATICRYPT_PASSWORD=… npm run build:internal
```

which runs `COMMONS_REVIEW=1 astro build`, then `protect:review` (staticrypt-encrypts
`dist/review/index.html` into `dist-review-protected/`) and `verify:review`
(asserts exactly one HTML file, a staticrypt marker, no `/_astro` references, and no
canary strings in plaintext). The password comes only from the environment — never a
file, never a commit. `.staticrypt.json` holds only the salt, and is committed so
"remember me" survives redeploys.

That artifact deploys to the existing `refibcn/commons-review` bucket — the bucket
name is deliberately unchanged (see the naming note above). The page is
deliberately self-contained: all KB markup, CSS and JS are inline so that staticrypt
encrypts every byte of it. Do not "optimise" it into shared `/_astro` chunks —
`verify:review` will fail, and rightly so.

## Deploy model

Static build, published to GitHub Pages from the `refibcn/refi-bcn-knowledge` repo.

### The custom domain is staged, not live — `public/CNAME.pending`

The custom domain file is committed as **`public/CNAME.pending`**, not `public/CNAME`.
Its contents are already exactly right (`knowledge.refibcn.cat`); only the filename is
holding it back, so activation is a rename.

**Why it is deliberately not `CNAME` yet.** A published `CNAME` file tells GitHub Pages
to 301-redirect _every_ request from `refibcn.github.io/refi-bcn-knowledge/*` to
`https://knowledge.refibcn.cat/*`. Until the DNS record exists, that hostname does not
resolve — so the whole site becomes **completely unreachable**, at any URL, and GitHub
cannot provision the TLS certificate (Let's Encrypt validation needs the record to
resolve first), leaving HTTPS broken too. This is not a cosmetic problem: it takes the
deployment fully offline and blocks the hashed-asset verification in Task 12.

**Activation — one atomic change, both halves together:**

```bash
# 1. Create the DNS record: knowledge.refibcn.cat  CNAME  refibcn.github.io
# 2. Confirm it resolves:   dig +short knowledge.refibcn.cat
# 3. Only then:
git mv public/CNAME.pending public/CNAME
```

Do not rename ahead of the DNS record. Do not add a `CNAME` alongside the `.pending`
file — exactly one of the two should exist at any time.

### Pre-DNS URL caveat

`astro.config.mjs` sets `site: "https://knowledge.refibcn.cat"` and **deliberately does
not set `base`**. The tradeoff:

- With no `base`, all assets resolve from `/`. That is correct for the custom domain,
  which is the target and the only supported URL.
- Setting `base: "/refi-bcn-knowledge"` would make the temporary GitHub project-page URL
  (`https://refibcn.github.io/refi-bcn-knowledge/`) work, but would then break every path
  once DNS lands and the site is served from the domain root.

You cannot have both from one build. **Known limitation:** while `CNAME.pending` is
staged, the site _is_ reachable at the project-page URL, but pages there render with
broken asset and link paths because every path resolves from `/` rather than
`/refi-bcn-knowledge/`. That is expected and temporary — do not "fix" it by adding
`base`, which would break the custom domain the moment DNS lands.

All URL construction goes through `withBase()` in `src/lib/paths.ts` rather than
hardcoding `/`, so if the decision is ever reversed the change is a single line in
`astro.config.mjs`.

## Conventions

- **Site identity** — one typed, validated export: `site` from `src/lib/site.ts`. Never
  read `src/data/site.yaml` directly; a missing key must fail the build, not render blank.
- **URLs** — always `withBase()` from `src/lib/paths.ts`, never a hardcoded leading `/`.
- **Path resolution** — resolve from `import.meta.url`, never `process.cwd()`, which
  depends on where the build was invoked from. The KB engine follows the same rule.
- **Fontsource packages live in `dependencies`, not `devDependencies`** (the sibling repos
  put them in devDeps). `Layout.astro` imports them at build time, so a `npm ci --omit=dev`
  build would fail otherwise. New repos in this family should follow this repo, not the
  siblings.

## Design system

- **Tokens and theme** — `src/styles/` copied from `refibcn-site` (tokens · theme swap
  point · `themes/editorial-organic.css` active). Same visual language as the website.
- **Chrome** — `Layout`, `Nav`, `Footer`, `Button` ported from `refibcn/rc2`.
- **Naming** — the outer chrome is externally neutral (BD-2026-060, superseding the
  earlier D0-interim position). Programme branding such as Regenerant Catalunya appears
  only inside the Catalonia sections, not in the nav, footer or site title.

## Licence

Code · MIT. Content · CC BY-SA 4.0.
