# refi-bcn-knowledge — ReFi BCN Knowledge Commons

The knowledge commons for ReFi Barcelona: an Astro 5 static site that publishes the
organization's knowledge base, its directory of organizations and programs, and a
Catalunya atlas.

This is instance 2 of a three-instance model:

| Instance             | Repo                 | Scope                                        |
| -------------------- | -------------------- | -------------------------------------------- |
| Website              | `refibcn-site`       | refibcn.cat — marketing / public front door   |
| **Knowledge Commons**| **this repo**        | knowledge.refibcn.cat — the commons + atlas   |
| Bioregioning Earth   | separate             | Wider bioregional programme                   |

## Two feeds

1. **Local `data/kb/`** — the knowledge base compiled inside the org-os checkout by the
   KB engine. This repo lives at `refi-bcn-os/repos/refi-bcn-knowledge/`, so the engine
   reaches its source over a relative path (`../../data/kb/`). **Do not relocate this
   repo** — later tooling depends on that depth.
2. **Notion CRM** — organizations, programs, events and territory records that feed the
   directory and the atlas, read through `@notionhq/client` with `NOTION_API_KEY`
   (copy `.env.example` to `.env`). Local YAML remains the source of truth for org-os
   registries; Notion is the CRM surface.

## Three lenses

| Lens               | Path               | Audience                                                  |
| ------------------ | ------------------ | --------------------------------------------------------- |
| Commons            | `/commons`         | Public. Reviewed, publishable knowledge pages.             |
| Commons review     | `/commons-review`  | Internal. Built only under `COMMONS_REVIEW=1` and shipped encrypted. |
| Atlas              | `/atlas`           | Public. Catalunya map — comarques and territorial context. |

## Commands

```bash
npm install
npm run dev       # local dev server
npm run build     # static build to dist/
npm run preview   # serve the built dist/
```

Scripts arrive incrementally as their files land:

- **Task 6** adds the KB engine.
- **Task 8** appends the public-KB gate to `build` (`astro build && node scripts/verify-public-kb.mjs`)
  and adds `export:public-kb`. Until then `build` is plain `astro build`.
- **Task 9** adds `protect:commons`, `verify:commons` and `build:internal`
  (`COMMONS_REVIEW=1 astro build && npm run protect:commons && npm run verify:commons`),
  plus the `test` script.

## Deploy model

Static build, published to GitHub Pages from the `refibcn/refi-bcn-knowledge` repo.
`public/CNAME` pins the custom domain `knowledge.refibcn.cat`.

### Pre-DNS URL caveat

`astro.config.mjs` sets `site: "https://knowledge.refibcn.cat"` and **deliberately does
not set `base`**. The tradeoff:

- With no `base`, all assets resolve from `/`. That is correct for the custom domain,
  which is the target and the only supported URL.
- Setting `base: "/refi-bcn-knowledge"` would make the temporary GitHub project-page URL
  (`https://refibcn.github.io/refi-bcn-knowledge/`) work, but would then break every path
  once DNS lands and the site is served from the domain root.

You cannot have both from one build. **Known limitation:** until the `knowledge.refibcn.cat`
DNS record is wired, the project-page URL will render with broken asset and link paths.
That is expected and temporary — do not "fix" it by adding `base`.

Components read `import.meta.env.BASE_URL` rather than hardcoding `/`, so if the decision
is ever reversed the change is a single line in `astro.config.mjs`.

## Design system

- **Tokens and theme** — `src/styles/` copied from `refibcn-site` (tokens · theme swap
  point · `themes/editorial-organic.css` active). Same visual language as the website.
- **Chrome** — `Layout`, `Nav`, `Footer`, `Button` ported from `refibcn/rc2`.
- **Naming** — the outer chrome is externally neutral (decision D0-interim). Programme
  branding such as Regenerant Catalunya appears only inside the Catalonia sections, not
  in the nav, footer or site title.

## Licence

Code · MIT. Content · CC BY-SA 4.0.
