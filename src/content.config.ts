// src/content.config.ts
// Astro v5 content collections — typed access to YAML data.
import { defineCollection, z } from "astro:content";
import yaml from "js-yaml";
import { readFileSync } from "node:fs";

const networkAccent = z.enum(["forest", "rust", "purple", "orange", "blue"]);
const theme = z.enum([
  "agroecology",
  "narrative",
  "governance",
  "river",
  "health",
  "education",
  "tourism",
  "housing",
  "textile",
  "food-sovereignty",
  "cooperative-housing",
]);

const projectSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  network: z.enum(["miceli", "keras-buti"]),
  theme,
  locality: z.string().min(1),
  geo: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
  image: z.string().nullable(),
  summary: z.string().min(1),
  links: z.object({
    web: z.string().nullable(),
    karma: z.string().nullable(),
    rc_page: z.string().nullable(),
  }),
  status: z.enum(["confirmed", "pending"]),
});

const networkMetaSchema = z.object({
  name: z.string(),
  role: z.string(),
  contribution_eur: z.number(),
  web: z.string(),
  accent: networkAccent,
  summary: z.string(),
});

export type Project = z.infer<typeof projectSchema>;
export type NetworkMeta = z.infer<typeof networkMetaSchema>;
export type CohortDoc = {
  networks: Record<"miceli" | "keras-buti", NetworkMeta>;
  projects: Project[];
  pending: { name: string }[];
  funders: { name: string; role: string; web: string }[];
};

// Astro collections are designed for many entries; here we have a single document.
// We use a custom loader that reads the whole YAML and emits one entry.
const cohort = defineCollection({
  loader: () => {
    const raw = readFileSync(
      new URL("./data/rc-cohort.yaml", import.meta.url),
      "utf8",
    );
    const doc = yaml.load(raw) as CohortDoc;
    return [{ id: "regenerant-catalunya", ...doc }];
  },
  schema: z.object({
    networks: z.object({
      miceli: networkMetaSchema,
      "keras-buti": networkMetaSchema,
    }),
    projects: z.array(projectSchema),
    pending: z.array(z.object({ name: z.string() })),
    funders: z.array(
      z.object({ name: z.string(), role: z.string(), web: z.string() }),
    ),
  }),
});

export const collections = { cohort };
