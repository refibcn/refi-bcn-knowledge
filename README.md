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

1. **Local `data/kb/`** — the knowledge base compiled inside the org-os checkout by the
   KB engine. This repo lives at `refi-bcn-os/repos/refi-bcn-knowledge/`, so the engine
   reaches its source over a relative path (`../../data/kb/`). **Do not relocate this
   repo** — later tooling depends on that depth.
2. **Notion CRM** — organizations, programs, events and territory records that feed the
   directory and the atlas, read through `@notionhq/client` with `NOTION_API_KEY`
   (copy `.env.example` to `.env`). Local YAML remains the source of truth for org-os
   registries; Notion is the CRM surface.

### The store is outside this repo — two committed derivations bridge the gap

Feed 1 lives in the org-os checkout, which CI does **not** have: GitHub Actions clones
this repo standalone, so `resolveKbDir()` falls back to `data/kb-public/` — the exported
public subset, which is legitimately **empty** until human review promotes objects.
`export:public-kb` cannot fill it, and must not be made to: `publishableKb()` is
fail-closed by design.

So the aggregates a public page needs are **derived from the workspace and committed**:

| Artifact                            | Command                      | What it holds                                                                  |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `src/data/sources-disposition.json` | `npm run derive:disposition` | Per-source file disposition from `refi-bcn-os/docs/kms/batches/*.yaml`.        |
| `src/data/kb-summary.json`          | `npm run derive:kb-summary`  | Per-container and global object counts + the `source-system` cards. No bodies. |

**Re-run BOTH after any ingest batch, and commit the regenerated JSON with the change.**
They are derived data under version control, so they go stale silently. `npm test` pins
that: `tests/kb-summary.test.mjs` recomputes the summary from the live store and fails if
the committed file disagrees (skipped when there is no workspace store, i.e. in CI).

`derive:kb-summary` **refuses** to run when it can only see `data/kb-public/` — deriving
there would write zeros over good data and render `/sources` as "nothing ingested", which
is the reading that could authorise archiving an unprocessed source.

The summary carries counts and the source cards only. Object titles, bodies, slugs and
origins are excluded, and the script asserts that rather than promising it.

## Three lenses

| Lens      | Path         | Audience                                                             |
| --------- | ------------ | -------------------------------------------------------------------- |
| Knowledge | `/knowledge` | Public. Reviewed, publishable knowledge pages.                       |
| Review    | `/review`    | Internal. Built only under `COMMONS_REVIEW=1` and shipped encrypted. |
| Atlas     | `/atlas`     | Public. Catalunya map — comarques and territorial context.           |

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

# Committed derivations — re-run both after every ingest batch
npm run derive:disposition   # → src/data/sources-disposition.json
npm run derive:kb-summary    # → src/data/kb-summary.json
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
