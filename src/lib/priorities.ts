// Ported from rc2; the `process.cwd()` YAML read was swapped for the
// bundle-time `?raw` import documented in `src/lib/site.ts`.
import * as yaml from "js-yaml";
import prioritiesYaml from "../data/priorities.yaml?raw";
import type { NormalizedRecord } from "./notion";

export type I18nString = { en: string; ca?: string };

export interface Priority {
  id: string;
  slug: string;
  order: number;
  name: I18nString;
  shortName: I18nString;
  color: string;
  keywords: string[];
  // Expanded fields used by the priorities section; optional for the refactor step.
  oneLiner?: I18nString;
  diagnosis?: I18nString;
  leverage?: I18nString;
  headlineIndicator?: string;
  indicators?: string[];
  framings?: Record<string, I18nString>;
  capital?: Array<{
    vehicle: string;
    instrument: string;
    horizon: string;
    ticket: string;
    rationale: I18nString;
    returns: string[];
  }>;
  sources?: Array<{ label: string; url: string; accessed: string }>;
}

export interface PrioritiesRegistry {
  priorities: Priority[];
}

export function loadPriorities(): Priority[] {
  const parsed = yaml.load(prioritiesYaml) as PrioritiesRegistry;
  return parsed.priorities ?? [];
}

export function getPriorityById(id: string): Priority | undefined {
  return loadPriorities().find((p) => p.id === id);
}

export function priorityAreaOptions(): string[] {
  return loadPriorities().map((p) => p.id);
}

export function priorityColor(id: string): string {
  const priority = getPriorityById(id);
  return priority?.color ?? "#1d1a16";
}

export function inferPriorities(
  record: NormalizedRecord,
  priorities?: Priority[],
): string[] {
  const list = priorities ?? loadPriorities();
  const haystack = extractSearchText(record).toLowerCase();
  const matched = new Set<string>();

  for (const priority of list) {
    for (const keyword of priority.keywords) {
      if (haystack.includes(keyword.toLowerCase())) {
        matched.add(priority.id);
        break;
      }
    }
  }

  return Array.from(matched);
}

function extractSearchText(record: NormalizedRecord): string {
  const props = record.properties;
  const fields = [
    "Name",
    "Description",
    "SAP",
    "Agency",
    "Area1",
    "Area2",
    "Memes",
    "2NDTAG",
  ];

  return fields
    .map((key) => {
      const value = props[key];
      if (value === null || value === undefined) return "";
      if (Array.isArray(value)) return value.join(" ");
      return String(value);
    })
    .join(" ");
}
