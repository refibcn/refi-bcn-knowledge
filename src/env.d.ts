/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  /** Notion integration token (`refi-bcn-os`), read at build time only.
   *  Unprefixed, so Astro never exposes it to the client bundle. Absent in
   *  environments without a `.env`; `src/lib/notion.ts` throws in that case and
   *  the directory pages render their "unavailable" state. */
  readonly NOTION_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
