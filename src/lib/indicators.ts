// Ported from rc2; the `process.cwd()` YAML read was swapped for the
// bundle-time `?raw` import documented in `src/lib/site.ts`.
import * as yaml from "js-yaml";
import indicatorsYaml from "../data/indicators-static.yaml?raw";

export type I18nString = { en: string; ca?: string };

export type IndicatorStatus =
  "in_overshoot" | "under_strain" | "holding" | "improving";

export type IndicatorTrend = "improving" | "worsening" | "stable";

export type IndicatorSourceType = "socrata" | "idescat" | "static" | "derived";

export interface IndicatorSource {
  type: IndicatorSourceType;
  label: string;
  url: string;
  license: string;
  accessed: string;
  domain?: string;
  dataset?: string;
  query?: string;
}

export interface Indicator {
  id: string;
  priority: string;
  label: I18nString;
  value: string;
  unit: string;
  status: IndicatorStatus;
  trend: IndicatorTrend;
  threshold: string;
  thresholdLabel: I18nString;
  confidence: "high" | "medium" | "low";
  source: IndicatorSource;
  lastVerified: string;
  note?: I18nString;
}

export interface IndicatorsRegistry {
  indicators: Indicator[];
}

export function loadIndicators(): Indicator[] {
  const parsed = yaml.load(indicatorsYaml) as IndicatorsRegistry;
  return parsed.indicators ?? [];
}

export function getIndicatorById(id: string): Indicator | undefined {
  return loadIndicators().find((i) => i.id === id);
}

export function getIndicatorsByPriority(priorityId: string): Indicator[] {
  return loadIndicators().filter((i) => i.priority === priorityId);
}

export function getHeadlineIndicator(
  priorityId: string,
): Indicator | undefined {
  const indicators = getIndicatorsByPriority(priorityId);
  return indicators[0];
}
