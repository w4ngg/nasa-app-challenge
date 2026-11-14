// Keep response types aligned with apps/api/src/flame_api/models.py.
// The API publishes its canonical contract at /openapi.json.
export interface Investigation {
  id: string;
  title: string;
  acronym: string | null;
  family: string | null;
  family_basis: string | null;
  research_area: string | null;
  project_type: string | null;
  objective: string;
  approach: string;
  hardware: string | null;
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
