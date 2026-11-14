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


class Investigation(Record):
    id: str = Field(pattern=r"^PSI-\d+$")
    title: str = Field(min_length=1)
    acronym: str | None = None
    family: str | None = None
    family_basis: str | None = None
    research_area: str | None = None
    project_type: str | None = None
    objective: str = ""
    approach: str = ""
    hardware: str | None = None
    related_ids: list[str] = Field(default_factory=list)
    dataset_doi: str | None = None
    source_url: str


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
    schema_version: Literal[1] = 1
    query: str = "combustion"
    retrieved_at: datetime | None = None
    investigations: list[Investigation] = Field(default_factory=list)
    publications: list[Publication] = Field(default_factory=list)
    links: list[PublicationLink] = Field(default_factory=list)

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


class InvestigationDetail(Record):
    investigation: Investigation
    publications: list[Publication]
