from fastapi.testclient import TestClient

from flame_api.config import Settings
from flame_api.main import create_app


def client(tmp_path):
    return TestClient(create_app(Settings(tmp_path / "catalog.json", ())))


def psi159_input():
    return {
        "flame_type": "Normal",
        "fuel": "ethane",
        "pressure_bar": 1.0,
        "o2_fraction": 0.21,
        "fuel_fraction": 0.0,
        "hc_flow_mg_s": 1.0,
        "tad_k": 300.0,
        "zst": 0.05,
    }


def test_forecast_metadata_and_real_artifact_inference(tmp_path):
    with client(tmp_path) as api:
        metadata = api.get("/api/v1/forecast/metadata")
        assert metadata.status_code == 200, metadata.text
        assert metadata.json()["sources"]["PSI-159"]["model"] == "xgboost"
        assert metadata.json()["sources"]["PSI-69"]["model"] == "extra_trees"

        response = api.post("/api/v1/forecast", json={"source": "PSI-159", "inputs": psi159_input()})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["source"] == "PSI-159"
        assert body["model"] == "xgboost"
        assert body["predicted_burn_time_s"] >= 0
        assert body["interval"]["lower_s"] >= 0
        assert body["interval"]["upper_s"] >= body["predicted_burn_time_s"]


def test_forecast_imputes_missing_number_and_rejects_unsupported_inputs(tmp_path):
    inputs = psi159_input()
    inputs.pop("zst")
    inputs["peak_burner_temperature"] = 600
    with client(tmp_path) as api:
        response = api.post("/api/v1/forecast", json={"source": "PSI-159", "inputs": inputs})
    assert response.status_code == 422
    assert "unsupported inputs" in response.json()["detail"]

    inputs.pop("peak_burner_temperature")
    with client(tmp_path) as api:
        response = api.post("/api/v1/forecast", json={"source": "PSI-159", "inputs": inputs})
    assert response.status_code == 200, response.text
    assert response.json()["imputed_inputs"]["zst"] == 0.266857037


def test_forecast_rejects_physically_invalid_fraction(tmp_path):
    inputs = psi159_input()
    inputs["o2_fraction"] = 1.2
    with client(tmp_path) as api:
        response = api.post("/api/v1/forecast", json={"source": "PSI-159", "inputs": inputs})
    assert response.status_code == 422
    assert response.json()["detail"] == "o2_fraction must be between 0 and 1"
