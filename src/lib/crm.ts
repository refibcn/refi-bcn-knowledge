import type { NormalizedRecord } from "./notion";
import {
  priorityAreaOptions as priorityAreaOptionsFromYaml,
  priorityColor as priorityColorFromYaml,
  loadPriorities,
} from "./priorities";

export interface CrmActor {
  id: string;
  name: string;
  description: string;
  whyItMatters: string;
  website: string | null;
  publicEmail: string | null;
  linkedin: string | null;
  actorType: string | null;
  actorRoles: string[];
  secondTags: string[];
  thirdTags: string[];
  area2: string[];
  climateZone: string | null;
  themes: string[];
  ontologyTags: string[];
  relatedInitiatives: string[];
  relatedProjects: string[];
  relatedEvents: string[];
  relatedResources: string[];
}

export interface CrmProgram {
  id: string;
  name: string;
  description: string;
  whatItIs: string;
  website: string | null;
  area2: string[];
  agency: string | null;
  secondTags: string[];
}

export interface CrmEvent {
  id: string;
  name: string;
  about: string;
  whatItIs: string;
  date: string;
  startDate: string | null;
  location: string;
  link: string | null;
  type: string | null;
  secondTags: string[];
}

export type CrmRecord = CrmActor | CrmProgram | CrmEvent;

function toStringArray(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === null || value === undefined || value === "") return [];
  return [String(value)];
}

function parseDelimitedText(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    return value
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseDelimitedTitleCase(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => toTitleCase(String(v)));
  if (typeof value === "string") {
    return value
      .split(/[,;]/)
      .map((s) => toTitleCase(s.trim()))
      .filter(Boolean);
  }
  return [];
}

function toNullableString(value: any): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function formatDate(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const start = value.start ?? value.date ?? "";
    const end = value.end ?? "";
    if (start && end && start !== end) return `${start} → ${end}`;
    return String(start);
  }
  return String(value);
}

function extractStartDate(value: any): string | null {
  if (!value) return null;
  if (typeof value === "object" && value !== null) {
    return value.start ?? value.date ?? null;
  }
  if (typeof value === "string") {
    const match = value.match(/^([^→]+)/);
    if (match) return match[1].trim();
  }
  return null;
}

export function normalizeRecord(record: NormalizedRecord): CrmActor {
  const props = record.properties;
  return {
    id: record.id,
    name: String(props["Name"] ?? "Untitled"),
    description: String(props["Description"] ?? ""),
    whyItMatters: String(props["SAP"] ?? ""),
    website: toNullableString(props["Website"]),
    publicEmail: toNullableString(props["Public Email"]),
    linkedin: toNullableString(props["LinkedIn"]),
    actorType: toNullableString(props["Agency"]),
    actorRoles: parseDelimitedTitleCase(props["Actor Role"]),
    secondTags: toStringArray(props["2NDTAG"]),
    thirdTags: toStringArray(props["3RDTAG"]),
    area2: toStringArray(props["Area2"]),
    climateZone: toNullableString(props["Climate zone"]),
    themes: toStringArray(props["Memes"]),
    ontologyTags: parseDelimitedText(props["Ontology Tags"]),
    relatedInitiatives: toStringArray(
      props["related programs and initiatives"],
    ),
    relatedProjects: toStringArray(props["Projects & Areas"]),
    relatedEvents: toStringArray(props["Events"]),
    relatedResources: toStringArray(props["Artifacts"]),
  };
}

export function normalizeProgram(record: NormalizedRecord): CrmProgram {
  const props = record.properties;
  return {
    id: record.id,
    name: String(props["Name"] ?? "Untitled"),
    description: String(props["Description"] ?? ""),
    whatItIs: String(props["What it is"] ?? ""),
    website: toNullableString(
      props["Website"] ??
        props["Link"] ??
        props["URL"] ??
        props["Website 1"] ??
        props["Website 2"],
    ),
    area2: toStringArray(props["Area2"]),
    agency: toNullableString(props["Agency"]),
    secondTags: toStringArray(props["2NDTAG"]),
  };
}

export function normalizeEvent(record: NormalizedRecord): CrmEvent {
  const props = record.properties;
  const dateValue = props["Date"];
  return {
    id: record.id,
    name: String(props["Event"] ?? props["Name"] ?? "Untitled"),
    about: String(props["About"] ?? ""),
    whatItIs: String(props["What it is"] ?? ""),
    date: formatDate(dateValue),
    startDate: extractStartDate(dateValue),
    location: String(props["Location"] ?? ""),
    link: toNullableString(props["Link"]),
    type: toNullableString(props["Type"]),
    secondTags: toStringArray(
      props["Select"] ?? props["2NDTAG"] ?? props["Tag"] ?? props["Tags"],
    ),
  };
}

export function hasCatbis(record: NormalizedRecord | CrmRecord): boolean {
  if ("secondTags" in record && Array.isArray(record.secondTags)) {
    return record.secondTags.some((t) => t.toLowerCase() === "catbis");
  }
  const props = (record as NormalizedRecord).properties ?? {};
  const candidates = [
    props["2NDTAG"],
    props["Select"],
    props["Tag"],
    props["Tags"],
  ];
  for (const value of candidates) {
    if (value === undefined || value === null) continue;
    const tags = toStringArray(value);
    if (tags.some((t) => t.toLowerCase() === "catbis")) return true;
  }
  return false;
}

export function uniqueValues<T extends Record<string, any>>(
  records: T[],
  key: keyof T,
): string[] {
  const values = new Set<string>();
  for (const record of records) {
    const v = record[key];
    if (Array.isArray(v)) {
      for (const item of v as any[]) values.add(String(item));
    } else if (v !== null && v !== undefined && v !== "") {
      values.add(String(v));
    }
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

export const priorityAreaOptions = priorityAreaOptionsFromYaml();

export function priorityColor(priorityId: string): string {
  return priorityColorFromYaml(priorityId);
}

export function inferPriorityTags(
  record: NormalizedRecord | CrmProgram,
): string[] {
  const priorities = loadPriorities();
  const props = "properties" in record ? record.properties : (record as any);
  const haystack = [
    props["Name"] ?? "",
    props["Description"] ?? "",
    props["What it is"] ?? "",
    props["Agency"] ?? "",
    ...(Array.isArray(props["Memes"])
      ? props["Memes"]
      : [props["Memes"] ?? ""]),
  ]
    .map((v) => String(v).toLowerCase())
    .join(" ");
  const matched = new Set<string>();
  for (const priority of priorities) {
    for (const keyword of priority.keywords) {
      if (haystack.includes(keyword.toLowerCase())) {
        matched.add(priority.id);
        break;
      }
    }
  }
  return Array.from(matched);
}

export const territoryOptions = [
  "regional",
  "Barcelona province",
  "Girona province",
  "Lleida province",
  "Tarragona province",
  "Alt Camp",
  "Alt Empordà",
  "Alt Penedès",
  "Alt Urgell",
  "Alta Ribagorça",
  "Anoia",
  "Aran",
  "Bages",
  "Baix Camp",
  "Baix Ebre",
  "Baix Empordà",
  "Baix Llobregat",
  "Baix Penedès",
  "Barcelonès",
  "Berguedà",
  "Cerdanya",
  "Conca de Barberà",
  "Garraf",
  "Garrigues",
  "Garrotxa",
  "Gironès",
  "Lluçanès",
  "Maresme",
  "Moianès",
  "Montsià",
  "Noguera",
  "Osona",
  "Pallars Jussà",
  "Pallars Sobirà",
  "Pla de l'Estany",
  "Pla d'Urgell",
  "Priorat",
  "Ribera d'Ebre",
  "Ripollès",
  "Segarra",
  "Segrià",
  "La Selva",
  "Solsonès",
  "Tarragonès",
  "Terra Alta",
  "Urgell",
  "Vallès Occidental",
  "Vallès Oriental",
];
