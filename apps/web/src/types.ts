// Keep response types aligned with apps/api/src/flame_api/models.py.
// The API publishes its canonical contract at /openapi.json.
export type Platform = "iss" | "cygnus" | "ground" | "unknown";
export type Topic = "fire_safety" | "gaseous_flames" | "droplets" | "surface" | "other";
export type FuelCategory = "gas" | "liquid" | "solid" | "aerosol";
export type O2Basis = "ambient" | "oxidizer_stream";

export interface O2Observation {
  min_percent: number;
  max_percent: number;
  basis: O2Basis;
  source_file: string;
  source_column: string;
  runs_with_value: number;
}

export interface Conditions {
  fuels: string[];
  fuel_categories: FuelCategory[];
  fuel_groups: Record<string, FuelCategory>;
  fuel_runs: Record<string, number>;
  o2: O2Observation[];
  run_count: number;
  tables: string[];
}

export interface Investigation {
  id: string;
  title: string;
  acronym: string | null;
  family: string | null;
  family_basis: string | null;
  research_area: string | null;
  sub_research_area: string | null;
  topic: Topic;
  project_type: string | null;
  flight_program: string | null;
  platform: Platform;
  start_date: string | null;
  end_date: string | null;
  objective: string;
  approach: string;
  hypothesis: string;
  research_impacts: string;
  hardware: string | null;
  hardware_tags: string[];
  conditions: Conditions;
  related_ids: string[];
  dataset_doi: string | null;
  source_url: string;
}

export interface Publication {
  id: string;
  title: string;
  authors: string;
  doi: string | null;
  availability: "metadata_only" | "abstract" | "full_text";
  abstract: string | null;
}

export interface ExperimentalTable {
  investigation_id: string;
  file_name: string;
  columns: string[];
  rows: string[][];
  fuel_column: string | null;
  o2_column: string | null;
  o2_basis: O2Basis | null;
  note: string;
}

export interface InvestigationDetail {
  investigation: Investigation;
  publications: Publication[];
  tables: ExperimentalTable[];
  related: { id: string; title: string | null }[];
}

export interface FacetOption {
  value: string;
  count: number;
  group: string | null;
}

export interface Facets {
  families: FacetOption[];
  platforms: FacetOption[];
  topics: FacetOption[];
  hardware: FacetOption[];
  fuels: FacetOption[];
  with_o2: number;
  with_tables: number;
  o2_min: number | null;
  o2_max: number | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface Summary {
  investigations: number;
  publications: number;
  publication_links: number;
  full_text_publications: number;
  catalog_state: "empty" | "loaded";
  retrieved_at: string | null;
}
