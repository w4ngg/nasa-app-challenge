import logging
import re
from collections import Counter
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError

from ..ingestion.tables import FUEL_CATEGORY
from ..models import (
    Catalog, ContentAvailability, FacetOption, Facets, Investigation, InvestigationDetail, Page,
    Publication, RelatedInvestigation, Summary,
)

router = APIRouter(prefix="/api/v1", tags=["catalog"])
logger = logging.getLogger(__name__)


def get_catalog(request: Request) -> Catalog:
    try:
        return request.app.state.catalog_repository.read()
    except (OSError, ValidationError) as error:
        logger.exception("Unable to read catalog")
        raise HTTPException(status_code=503, detail="The catalog could not be loaded") from error


CatalogDependency = Annotated[Catalog, Depends(get_catalog)]
Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


@router.get("/summary", response_model=Summary)
def summary(catalog: CatalogDependency) -> Summary:
    return Summary(
        investigations=len(catalog.investigations),
        publications=len(catalog.publications),
        publication_links=len(catalog.links),
        full_text_publications=sum(
            p.availability == ContentAvailability.FULL_TEXT for p in catalog.publications
        ),
        catalog_state="loaded" if catalog.investigations else "empty",
        retrieved_at=catalog.retrieved_at,
    )


ListParam = Annotated[list[str], Query()]
Percent = Annotated[float | None, Query(ge=0, le=100)]


def normalize(text: str) -> str:
    """Lower-case and treat hyphens as spaces, matching apps/web/src/lib/data.ts."""
    return re.sub(r"[-‐-―_]", " ", text.casefold())


def search_text(record: Investigation, catalog: Catalog) -> str:
    pubs = {p.id: p for p in catalog.publications}
    linked = [pubs[l.publication_id] for l in catalog.links if l.investigation_id == record.id]
    return normalize(" ".join([
        record.id, record.title, record.acronym or "", record.family or "", record.objective,
        record.approach, record.hardware or "", " ".join(record.conditions.fuels),
        *(f"{p.title} {p.authors} {p.doi or ''}" for p in linked),
    ]))


def matches_o2(record: Investigation, low: float, high: float, ambient_only: bool) -> bool:
    return any(
        o.min_percent <= high and o.max_percent >= low
        for o in record.conditions.o2 if not ambient_only or o.basis == "ambient"
    )


@router.get("/investigations", response_model=Page[Investigation])
def investigations(
    catalog: CatalogDependency, q: str = "",
    family: ListParam = [], platform: ListParam = [], topic: ListParam = [],
    hardware: ListParam = [], fuel: ListParam = [],
    o2_min: Percent = None, o2_max: Percent = None, o2_ambient_only: bool = False,
    has_table: bool = False, limit: Limit = 50, offset: Offset = 0,
) -> Page[Investigation]:
    """Values inside one filter are OR-ed; different filters are AND-ed.

    Any oxygen bound (or o2_ambient_only) keeps only investigations whose
    experimental tables report oxygen overlapping the requested range.
    """
    words = normalize(q).split()
    families = {f.casefold() for f in family}
    o2_active = o2_min is not None or o2_max is not None or o2_ambient_only
    low, high = o2_min if o2_min is not None else 0, o2_max if o2_max is not None else 100
    if low > high:
        raise HTTPException(status_code=422, detail="o2_min must not exceed o2_max")
    records = [
        r for r in catalog.investigations
        if (not families or (r.family or "").casefold() in families)
        and (not platform or r.platform in platform)
        and (not topic or r.topic in topic)
        and (not hardware or set(hardware) & set(r.hardware_tags))
        and (not fuel or set(fuel) & set(r.conditions.fuels))
        and (not o2_active or matches_o2(r, low, high, o2_ambient_only))
        and (not has_table or r.conditions.run_count > 0)
        and (not words or all(w in search_text(r, catalog) for w in words))
    ]
    return Page(items=records[offset:offset + limit], total=len(records), offset=offset, limit=limit)


def options(values: list[str], groups: dict[str, str] | None = None) -> list[FacetOption]:
    counts = Counter(values)
    return [FacetOption(value=v, count=n, group=(groups or {}).get(v))
            for v, n in sorted(counts.items(), key=lambda item: (-item[1], item[0]))]


@router.get("/facets", response_model=Facets)
def facets(catalog: CatalogDependency) -> Facets:
    """Filter options with counts over the whole catalog."""
    records = catalog.investigations
    categories = {f: FUEL_CATEGORY[f] for r in records for f in r.conditions.fuels if f in FUEL_CATEGORY}
    o2 = [o for r in records for o in r.conditions.o2]
    return Facets(
        families=options([r.family for r in records if r.family]),
        platforms=options([r.platform for r in records]),
        topics=options([r.topic for r in records]),
        hardware=options([t for r in records for t in r.hardware_tags]),
        fuels=options([f for r in records for f in r.conditions.fuels], categories),
        with_o2=sum(bool(r.conditions.o2) for r in records),
        with_tables=sum(r.conditions.run_count > 0 for r in records),
        o2_min=min((o.min_percent for o in o2), default=None),
        o2_max=max((o.max_percent for o in o2), default=None),
    )


@router.get("/investigations/{investigation_id}", response_model=InvestigationDetail)
def investigation_detail(investigation_id: str, catalog: CatalogDependency) -> InvestigationDetail:
    record = next((r for r in catalog.investigations if r.id == investigation_id), None)
    if record is None:
        raise HTTPException(status_code=404, detail="Investigation not found")
    pub_ids = {link.publication_id for link in catalog.links if link.investigation_id == record.id}
    titles = {r.id: r.title for r in catalog.investigations}
    return InvestigationDetail(
        investigation=record,
        publications=[p for p in catalog.publications if p.id in pub_ids],
        tables=[t for t in catalog.tables if t.investigation_id == record.id],
        related=[RelatedInvestigation(id=i, title=titles.get(i)) for i in record.related_ids],
    )


@router.get("/publications", response_model=Page[Publication])
def publications(
    catalog: CatalogDependency, q: str = "", investigation_id: str | None = None,
    limit: Limit = 50, offset: Offset = 0,
) -> Page[Publication]:
    term = q.strip().casefold()
    allowed = None
    if investigation_id is not None:
        if not any(r.id == investigation_id for r in catalog.investigations):
            raise HTTPException(status_code=404, detail="Investigation not found")
        allowed = {link.publication_id for link in catalog.links if link.investigation_id == investigation_id}
    records = [p for p in catalog.publications
               if (allowed is None or p.id in allowed)
               and (not term or term in f"{p.title} {p.authors} {p.doi or ''}".casefold())]
    return Page(items=records[offset:offset + limit], total=len(records), offset=offset, limit=limit)
