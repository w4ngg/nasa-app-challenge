from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from flame_api.config import Settings
from flame_api.ingestion.psi import normalize_documents, write_catalog
from flame_api.ingestion.tables import match_fuels, parse_o2_percent
from flame_api.main import create_app


@pytest.mark.parametrize("cell,expected", [
    ("40% CH4 (balance N2) including 2 pyrometry calibration tests", ["Methane"]),
    ("40% CH7", []),  # spreadsheet autofill artifact, not a fuel
    ("Methanol", ["Methanol"]),
    ("Ethanol (pure)", ["Ethanol"]),
    ("IsoOctane (pure)", ["Isooctane"]),
    ("Heptane (50%) IsoOctane (50%) (mixture)", ["Isooctane", "n-Heptane"]),
    ("[.75]/[.25] C12H26/iso-dodecane", ["n-Dodecane", "Iso-dodecane"]),
    ("25% H2, 20% CH4, with He", ["Methane", "Hydrogen"]),
    ("20% C2H4 (balance N2)", ["Ethylene"]),
    ("Japan Wax candle", ["Wax / candle"]),
    ("2 cm sphere", []),  # material not named in the cell: do not guess
])
def test_fuel_dictionary(cell, expected):
    assert match_fuels(cell) == expected


@pytest.mark.parametrize("cell,unit,expected", [
    ("0.21", "fraction", [21.0]),
    ("0.17; 0.21;0.25; 0.3", "fraction", [17.0, 21.0, 25.0, 30.0]),
    ("22.2", "percent", [22.2]),
    ("21.5 - 21.7", "percent", [21.5, 21.7]),
    ("3400%", "percent", [34.0]),
    ("~30% and ~21% O2 with He", "text", [30.0, 21.0]),
    ("~21% O2 with N2", "text", [21.0]),
    ("", "fraction", []),
])
def test_oxygen_parsing(cell, unit, expected):
    assert parse_o2_percent(cell, unit) == expected


def doc(accession, acronym, program="International Space Station (ISS)", project="Microgravity Investigation",
        hardware="Combustion Integrated Rack (CIR)", sub="Droplets"):
    return {"accession": accession, "title": f"{acronym} investigation", "investigationAcronym": acronym,
            "researchArea": "Combustion Science", "subResearchArea": sub, "flightProgram": program,
            "projectType": project, "experimentHardware": hardware, "objective": "", "approach": ""}


FLEX = b"Fuel,O initial ambient composition; mole fraction\nMethanol,0.21\nHeptane,0.15\n"
BASS = b"Date,Fuel Sample Material\n1/1/2012,PMMA sphere 2 cm\n1/2/2012,Nomex III Natural\n"


@pytest.fixture
def client(tmp_path):
    catalog = normalize_documents(
        [doc("PSI-69", "FLEX"), doc("PSI-26", "BASS", hardware="Microgravity Science Glovebox", sub="Spacecraft Fire Safety"),
         doc("PSI-60", "", program="", project="Ground Investigation", hardware="", sub="Gaseous")],
        "combustion", datetime.now(timezone.utc),
        {"PSI-69": [("PSI-69_Experimental table_FLEX.csv", FLEX)],
         "PSI-26": [("PSI-26_Experimental table_BASS.csv", BASS)]},
    )
    path = tmp_path / "catalog.json"
    write_catalog(catalog, path)
    with TestClient(create_app(Settings(path, ()))) as client:
        yield client


def ids(response):
    assert response.status_code == 200, response.text
    return sorted(r["id"] for r in response.json()["items"])


def test_conditions_are_derived_from_tables(client):
    detail = client.get("/api/v1/investigations/PSI-69").json()
    conditions = detail["investigation"]["conditions"]
    assert conditions["fuels"] == ["n-Heptane", "Methanol"]
    assert conditions["fuel_runs"] == {"n-Heptane": 1, "Methanol": 1}
    assert conditions["o2"][0]["min_percent"] == 15.0 and conditions["o2"][0]["max_percent"] == 21.0
    assert conditions["run_count"] == 2
    assert conditions["o2"][0]["values"] == [15.0, 21.0]
    assert detail["tables"][0]["rows"] == [["Methanol", "0.21"], ["Heptane", "0.15"]]


def test_filters_combine_with_and_across_and_or_within(client):
    api = "/api/v1/investigations"
    assert ids(client.get(api, params={"fuel": "PMMA"})) == ["PSI-26"]
    assert ids(client.get(api, params=[("fuel", "PMMA"), ("fuel", "Methanol")])) == ["PSI-26", "PSI-69"]
    assert ids(client.get(api, params={"fuel": "PMMA", "platform": "ground"})) == []
    assert ids(client.get(api, params={"platform": "ground"})) == ["PSI-60"]
    assert ids(client.get(api, params={"hardware": "MSG"})) == ["PSI-26"]
    assert ids(client.get(api, params={"topic": "fire_safety"})) == ["PSI-26"]
    assert ids(client.get(api, params={"q": "nomex"})) == ["PSI-26"]
    assert ids(client.get(api, params={"has_table": "true"})) == ["PSI-26", "PSI-69"]


def test_oxygen_filter_excludes_unknown_and_checks_overlap(client):
    api = "/api/v1/investigations"
    assert ids(client.get(api, params={"o2_min": 10, "o2_max": 16})) == ["PSI-69"]
    assert ids(client.get(api, params={"o2_min": 25})) == []
    assert client.get(api, params={"o2_min": 30, "o2_max": 20}).status_code == 422
    assert client.get(api, params={"o2_max": 120}).status_code == 422


def test_static_export_splits_index_and_tables(tmp_path):
    import json
    from flame_api.export_static import export
    catalog = normalize_documents(
        [doc("PSI-69", "FLEX"), doc("PSI-60", "", project="Ground Investigation")], "combustion",
        datetime.now(timezone.utc), {"PSI-69": [("PSI-69_Experimental table_FLEX.csv", FLEX)]},
    )
    (tmp_path / "tables").mkdir()
    (tmp_path / "tables" / "PSI-1.json").write_text("[]")  # stale file from an older export
    result = export(catalog, tmp_path)
    assert result["investigations"] == 2 and result["table_files"] == 1 and result["graph_nodes"] > 0
    assert (tmp_path / "graph.json").exists()
    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
    assert "tables" not in index and len(index["investigations"]) == 2
    assert sorted(p.name for p in (tmp_path / "tables").iterdir()) == ["PSI-69.json"]


def test_facets_count_the_catalog(client):
    facets = client.get("/api/v1/facets").json()
    assert {f["value"]: f["count"] for f in facets["platforms"]} == {"iss": 2, "ground": 1}
    assert {f["value"]: f["group"] for f in facets["fuels"]}["PMMA"] == "solid"
    assert facets["with_o2"] == 1 and facets["with_tables"] == 2
    assert facets["o2_min"] == 15.0 and facets["o2_max"] == 21.0


def test_graph_hierarchy_cross_links_and_evidence():
    from flame_api.graph import build_graph
    catalog = normalize_documents(
        [{**doc("PSI-69", "FLEX"), "objective": "Measure droplet extinction and the effectiveness of fire suppressants.",
          # Listed on one side only, by the ID that sorts after the other: must still give an edge.
          "related_glds": "PSI-26",
          "publications": [{"title": "Droplet extinction in microgravity", "authorList": "A", "doi": "10.1234/shared"}]},
         {**doc("PSI-26", "BASS", hardware="Microgravity Science Glovebox"), "objective": "Flame spread over solids.",
          "publications": [{"title": "Droplet extinction in microgravity", "authorList": "A", "doi": "10.1234/shared"}]}],
        "combustion", datetime.now(timezone.utc),
        {"PSI-69": [("PSI-69_Experimental table_FLEX.csv", FLEX)]},
    )
    g = build_graph(catalog)
    kinds = {(e["source"], e["type"], e["target"]) for e in g["edges"]}
    assert ("resource:psi", "includes", "program:FLEX") in kinds
    assert ("program:FLEX", "includes", "PSI-69") in kinds
    assert ("PSI-69", "has_dataset", "dataset:PSI-69_Experimental table_FLEX.csv") in kinds
    assert ("PSI-69", "uses_fuel", "fuel:methanol") in kinds
    assert ("PSI-69", "studies", "concept:suppression") in kinds
    assert ("PSI-26", "studies", "concept:flame-spread") in kinds
    assert ("PSI-69", "related_to", "PSI-26") in kinds
    assert sum(1 for e in g["edges"] if e["type"] == "related_to") == 1
    shared = [e for e in g["edges"] if e["type"] == "lists_publication"]
    assert len(shared) == 2 and len({e["target"] for e in shared}) == 1  # one publication, two parents
    assert all(e["evidence"] and e["url"] for e in g["edges"])
    assert "concept:fire-detection" not in {n["id"] for n in g["nodes"]}  # no match, no node
