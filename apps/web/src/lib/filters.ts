export interface Filters {
  q: string;
  family: string[];
  platform: string[];
  topic: string[];
  hardware: string[];
  fuel: string[];
  o2Min: string;
  o2Max: string;
  ambientOnly: boolean;
  hasTable: boolean;
}

export type ListKey = "family" | "platform" | "topic" | "hardware" | "fuel";

export const emptyFilters: Filters = {
  q: "", family: [], platform: [], topic: [], hardware: [], fuel: [],
  o2Min: "", o2Max: "", ambientOnly: false, hasTable: false,
};

const lists: ListKey[] = ["family", "platform", "topic", "hardware", "fuel"];

/** Filters live in the URL so a filtered view can be shared; names match the API query parameters. */
export function filtersFromUrl(params: URLSearchParams): Filters {
  return {
    q: params.get("q") ?? "",
    family: params.getAll("family"),
    platform: params.getAll("platform"),
    topic: params.getAll("topic"),
    hardware: params.getAll("hardware"),
    fuel: params.getAll("fuel"),
    o2Min: params.get("o2_min") ?? "",
    o2Max: params.get("o2_max") ?? "",
    ambientOnly: params.get("o2_ambient_only") === "true",
    hasTable: params.get("has_table") === "true",
  };
}

export function filtersToParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  for (const key of lists) for (const value of filters[key]) params.append(key, value);
  if (validPercent(filters.o2Min)) params.set("o2_min", filters.o2Min);
  if (validPercent(filters.o2Max)) params.set("o2_max", filters.o2Max);
  if (filters.ambientOnly) params.set("o2_ambient_only", "true");
  if (filters.hasTable) params.set("has_table", "true");
  return params;
}

export function validPercent(value: string): boolean {
  if (value.trim() === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100;
}

export function o2RangeError(filters: Filters): string | null {
  for (const value of [filters.o2Min, filters.o2Max]) {
    if (value.trim() !== "" && !validPercent(value)) return "Enter a number from 0 to 100.";
  }
  if (validPercent(filters.o2Min) && validPercent(filters.o2Max) && Number(filters.o2Min) > Number(filters.o2Max)) {
    return "“From” is higher than “to”.";
  }
  return null;
}

export function o2Active(filters: Filters): boolean {
  return validPercent(filters.o2Min) || validPercent(filters.o2Max) || filters.ambientOnly;
}

export function activeCount(filters: Filters): number {
  return lists.reduce((sum, key) => sum + filters[key].length, 0)
    + (o2Active(filters) ? 1 : 0) + (filters.hasTable ? 1 : 0) + (filters.q.trim() ? 1 : 0);
}
