# kb/ — the typed knowledge store

The ReFi Barcelona knowledge instance's typed store, one markdown file per
object: `kb/<schema>/<slug>.md`.

## Contract

- **One file per object.** Frontmatter = the object's fields; body = the
  `notes` field (absent body = no notes). Nothing else is encoded in the file.
- **Schema = folder.** There is no `schema:` or `id:` field in frontmatter;
  the directory carries the schema, the filename carries the slug.
- **Ids/filenames are never hand-renamed.** Slugs are identity; renames break
  lineage and cross-references.
- **Publication stays fail-closed** in the site build (`publishableKb()`);
  nothing here is public by virtue of existing.
- **Views** live in the `.base` files at this root (Obsidian Bases). They are
  hand-tunable in the Obsidian UI; the `.base` file is the config
  source of truth.
- **Edited via Obsidian or scripts** — both are first-class; keep frontmatter
  valid YAML either way.

Migrated 2026-08-12 from `refi-bcn-os/data/kb/*.yaml` with a 422/422
round-trip fidelity proof (`scripts/migrate-kb-to-md.mjs` — the script header
documents the exact body-reattachment rule a loader must mirror).
