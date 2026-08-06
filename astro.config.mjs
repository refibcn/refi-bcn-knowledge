import { defineConfig } from "astro/config";

export default defineConfig({
  // Custom domain from day one; serves at refibcn.github.io/refi-bcn-knowledge
  // until DNS lands. No `base` is set on purpose — see README "Pre-DNS URL
  // caveat": the custom domain is the target, and setting `base` would break
  // the root path once DNS is wired.
  site: "https://knowledge.refibcn.cat",
  output: "static",
  build: { format: "directory" },
});
