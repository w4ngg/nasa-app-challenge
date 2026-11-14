"""Investigation, publication and their relationship are separate entities."""
from datetime import datetime
from enum import StrEnum
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContentAvailability(StrEnum):
    METADATA_ONLY = "metadata_only"
    ABSTRACT = "abstract"
    FULL_TEXT = "full_text"


Platform = Literal["iss", "cygnus", "ground", "unknown"]
Topic = Literal["fire_safety", "gaseous_flames", "droplets", "surface", "other"]
FuelCategory = Literal["gas", "liquid", "solid", "aerosol"]
O2Basis = Literal["ambient", "oxidizer_stream"]


class O2Observation(Record):
    """Oxygen range found in one experimental table, in percent by volume."""
    min_percent: float = Field(gt=0, le=100)
    max_percent: float = Field(gt=0, le=100)
    basis: O2Basis
    source_file: str
    source_column: str
    runs_with_value: int = Field(ge=0)
    # Distinct recorded levels (percent, one decimal), to tell runs near a level from a range that merely spans it.
    values: list[float] = Field(default_factory=list)


class Conditions(Record):
    """Derived from PSI experimental tables; empty when the investigation has none."""
    fuels: list[str] = Field(default_factory=list)
    fuel_categories: list[FuelCategory] = Field(default_factory=list)
    fuel_groups: dict[str, FuelCategory] = Field(default_factory=dict)
    # Table rows that name each fuel (a mixture row counts for every fuel it names).
    fuel_runs: dict[str, int] = Field(default_factory=dict)
    o2: list[O2Observation] = Field(default_factory=list)
    run_count: int = Field(default=0, ge=0)
    tables: list[str] = Field(default_factory=list)


class Investigation(Record):
    id: str = Field(pattern=r"^PSI-\d+$")
    title: str = Field(min_length=1)
    acronym: str | None = None
    family: str | None = None
    family_basis: str | None = None
    research_area: str | None = None
    sub_research_area: str | None = None
    topic: Topic = "other"
    project_type: str | None = None
    flight_program: str | None = None
    platform: Platform = "unknown"
    start_date: str | None = None
    end_date: str | None = None
    objective: str = ""
    approach: str = ""
    hypothesis: str = ""
    research_impacts: str = ""
    hardware: str | None = None
    hardware_tags: list[str] = Field(default_factory=list)
    conditions: Conditions = Field(default_factory=Conditions)
    related_ids: list[str] = Field(default_factory=list)
    dataset_doi: str | None = None
    source_url: str


class ExperimentalTable(Record):
    investigation_id: str
    file_name: str
    columns: list[str]
    rows: list[list[str]]
    fuel_column: str | None = None
    o2_column: str | None = None
    o2_basis: O2Basis | None = None
    note: str = ""


class Publication(Record):
    id: str
    title: str = Field(min_length=1)
    authors: str = ""
    doi: str | None = None
    availability: ContentAvailability = ContentAvailability.METADATA_ONLY
    abstract: str | None = None


class PublicationLink(Record):
    investigation_id: str
    publication_id: str
    source_entry: int = Field(ge=1)
    relation: Literal["listed_in_psi"] = "listed_in_psi"
    title_at_source: str
    doi_at_source: str | None = None


class Catalog(Record):
    schema_version: Literal[2] = 2
    query: str = "combustion"
    retrieved_at: datetime | None = None
    investigations: list[Investigation] = Field(default_factory=list)
    publications: list[Publication] = Field(default_factory=list)
    links: list[PublicationLink] = Field(default_factory=list)
    tables: list[ExperimentalTable] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_relationships(self) -> "Catalog":
        inv_ids = {record.id for record in self.investigations}
        pub_ids = {record.id for record in self.publications}
        if len(inv_ids) != len(self.investigations):
            raise ValueError("Duplicate investigation IDs")
        if len(pub_ids) != len(self.publications):
            raise ValueError("Duplicate publication IDs")
        entries = set()
        for link in self.links:
            if link.investigation_id not in inv_ids or link.publication_id not in pub_ids:
                raise ValueError("Publication link references an unknown record")
            key = (link.investigation_id, link.source_entry)
            if key in entries:
                raise ValueError("Duplicate source entry within an investigation")
            entries.add(key)
        for table in self.tables:
            if table.investigation_id not in inv_ids:
                raise ValueError("Experimental table references an unknown investigation")
        return self


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    offset: int
    limit: int


class Summary(Record):
    investigations: int
    publications: int
    publication_links: int
    full_text_publications: int
    catalog_state: Literal["empty", "loaded"]
    retrieved_at: datetime | None


class RelatedInvestigation(Record):
    id: str
    title: str | None = None


class InvestigationDetail(Record):
    investigation: Investigation
    publications: list[Publication]
    tables: list[ExperimentalTable] = Field(default_factory=list)
    related: list[RelatedInvestigation] = Field(default_factory=list)


class FacetOption(Record):
    value: str
    count: int
    group: str | None = None


class Facets(Record):
    families: list[FacetOption]
    platforms: list[FacetOption]
    topics: list[FacetOption]
    hardware: list[FacetOption]
    fuels: list[FacetOption]
    with_o2: int
    with_tables: int
    o2_min: float | None
    o2_max: float | None
