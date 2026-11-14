import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError

from ..models import (
    Catalog, ContentAvailability, Investigation, InvestigationDetail, Page,
    Publication, Summary,
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


@router.get("/investigations", response_model=Page[Investigation])
def investigations(
    catalog: CatalogDependency, q: str = "", family: str | None = None,
    limit: Limit = 50, offset: Offset = 0,
) -> Page[Investigation]:
    term = q.strip().casefold()
    records = [
        record for record in catalog.investigations
        if (not family or (record.family or "").casefold() == family.casefold())
        and (not term or term in " ".join([
            record.id, record.title, record.acronym or "", record.objective, record.approach
        ]).casefold())
    ]
    return Page(items=records[offset:offset + limit], total=len(records), offset=offset, limit=limit)


@router.get("/investigations/{investigation_id}", response_model=InvestigationDetail)
def investigation_detail(investigation_id: str, catalog: CatalogDependency) -> InvestigationDetail:
    record = next((r for r in catalog.investigations if r.id == investigation_id), None)
    if record is None:
        raise HTTPException(status_code=404, detail="Investigation not found")
    pub_ids = {link.publication_id for link in catalog.links if link.investigation_id == record.id}
    return InvestigationDetail(
        investigation=record,
        publications=[p for p in catalog.publications if p.id in pub_ids],
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
