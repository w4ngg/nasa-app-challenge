from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from flame_api.config import Settings
from flame_api.ingestion.psi import normalize_documents, normalize_doi, write_catalog
from flame_api.main import create_app
from flame_api.models import Catalog


def document(accession, publications=None, acronym="FLEX"):
    return {
        "accession": accession, "title": f"Test investigation {accession}",
        "investigationAcronym": acronym, "researchArea": "Combustion Science",
        "objective": "Study cool flame extinction", "approach": "Numerical analysis",
        "publications": publications or [],
    }


def publication(doi="10.1234/shared", title="Test publication"):
    return {"title": title, "authorList": "Test Author", "doi": doi}


def make_catalog():
    return normalize_documents([
        document("PSI-69", [publication()]),
        document("PSI-117", [publication(), publication("", "No DOI record")], acronym=""),
    ], "combustion", datetime.now(timezone.utc))


@pytest.fixture
def client(tmp_path):
    path = tmp_path / "catalog.json"
    write_catalog(make_catalog(), path)
    with TestClient(create_app(Settings(path, ("http://localhost:5173",)))) as client:
        yield client


def test_shared_publication_keeps_both_investigation_links(client):
    summary = client.get("/api/v1/summary").json()
    assert summary["investigations"] == 2
    assert summary["publications"] == 2
    assert summary["publication_links"] == 3
    assert summary["full_text_publications"] == 0
    first = client.get("/api/v1/investigations/PSI-69").json()
    second = client.get("/api/v1/investigations/PSI-117").json()
    assert len(first["publications"]) == 1
    assert len(second["publications"]) == 2
    assert first["publications"][0]["id"] == second["publications"][0]["id"]


def test_search_and_pagination_return_matching_total(client):
    response = client.get("/api/v1/investigations", params={"q": "COOL FLAME", "limit": 1})
    assert response.status_code == 200
    assert response.json()["total"] == 2
    assert len(response.json()["items"]) == 1
    assert client.get("/api/v1/investigations", params={"family": "flex"}).json()["total"] == 1
    assert client.get("/api/v1/investigations", params={"q": "no-match"}).json()["total"] == 0
    # Words match in any order, and publication titles, authors and DOIs count.
    assert client.get("/api/v1/investigations", params={"q": "flame cool"}).json()["total"] == 2
    assert client.get("/api/v1/investigations", params={"q": "No DOI record"}).json()["total"] == 1
    assert client.get("/api/v1/investigations", params={"q": "test author"}).json()["total"] == 2
    assert client.get("/api/v1/investigations", params={"q": "10.1234/shared"}).json()["total"] == 2
    assert client.get("/api/v1/investigations", params={"offset": -1}).status_code == 422
    assert client.get("/api/v1/investigations", params={"limit": 0}).status_code == 422


def test_publication_filter_uses_the_relation_table(client):
    response = client.get("/api/v1/publications", params={"investigation_id": "PSI-117", "q": "No DOI"})
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["doi"] is None
    assert response.json()["items"][0]["availability"] == "metadata_only"
    assert client.get("/api/v1/publications?investigation_id=PSI-99999").status_code == 404
    assert client.get("/api/v1/investigations/PSI-99999").status_code == 404


def test_missing_catalog_is_empty_but_invalid_catalog_is_unavailable(tmp_path):
    path = tmp_path / "missing.json"
    with TestClient(create_app(Settings(path, ()))) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert client.get("/api/v1/summary").json()["catalog_state"] == "empty"
        assert client.get("/api/v1/publications").json()["items"] == []
        path.write_text("not valid JSON")
        assert client.get("/api/v1/summary").status_code == 503


def test_catalog_rejects_dangling_links_and_duplicate_ids():
    content = make_catalog().model_dump(mode="json")
    content["links"][0]["publication_id"] = "missing"
    with pytest.raises(ValidationError, match="unknown record"):
        Catalog.model_validate(content)
    content = make_catalog().model_dump(mode="json")
    content["investigations"].append(content["investigations"][0])
    with pytest.raises(ValidationError, match="Duplicate investigation"):
        Catalog.model_validate(content)


def test_same_title_does_not_merge_different_or_missing_dois():
    catalog = normalize_documents([document("PSI-69", [
        publication("10.1234/conference"), publication("10.1234/journal"),
        publication(""), publication(""),
    ])], "combustion", datetime.now(timezone.utc))
    assert len(catalog.publications) == 4
    assert len(catalog.links) == 4


@pytest.mark.parametrize("value,expected", [
    ("https://doi.org/10.1234/EXAMPLE", "10.1234/example"),
    ("doi: 10.1234/example", "10.1234/example"),
    (None, None), ("not-a-doi", None),
])
def test_doi_normalization(value, expected):
    assert normalize_doi(value) == expected
