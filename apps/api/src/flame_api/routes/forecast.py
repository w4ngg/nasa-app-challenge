"""Local inference endpoint for the source-specific burn-time models."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated, Any, Literal

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/forecast", tags=["forecast"])

Source = Literal["PSI-159", "PSI-69"]


class BurnTimeForecastRequest(BaseModel):
    """One pre-test experiment described with the features of its selected source."""

    source: Source
    inputs: dict[str, str | float | int | None] = Field(
        description="Pre-test feature values. Required fields depend on source."
    )


class PredictionInterval(BaseModel):
    coverage: float
    lower_s: float
    upper_s: float
    method: str


class BurnTimeForecastResponse(BaseModel):
    source: Source
    model: str
    prediction_meaning: str
    predicted_burn_time_s: float
    interval: PredictionInterval


class ForecastUnavailable(RuntimeError):
    """The local model artifact or one of its runtime dependencies cannot be loaded."""


class ForecastService:
    """Loads the trusted local artifact lazily, once per FastAPI process."""

    def __init__(self, artifact_path: Path):
        self.artifact_path = artifact_path
        self._artifact: dict[str, Any] | None = None

    def _load(self) -> dict[str, Any]:
        if self._artifact is not None:
            return self._artifact
        if not self.artifact_path.is_file():
            raise ForecastUnavailable(f"Model artifact was not found: {self.artifact_path}")
        try:
            # Import lazily: catalog-only API use does not require ML dependencies.
            import joblib

            artifact = joblib.load(self.artifact_path)
        except Exception as error:  # pragma: no cover - exact errors vary by local ML runtime
            raise ForecastUnavailable("Model artifact could not be loaded; install the forecast dependencies.") from error
        if not isinstance(artifact, dict) or not isinstance(artifact.get("models"), dict) or not isinstance(artifact.get("metadata"), dict):
            raise ForecastUnavailable("Model artifact has an unsupported structure.")
        self._artifact = artifact
        return artifact

    def source_metadata(self, source: Source) -> dict[str, Any]:
        artifact = self._load()
        try:
            metadata = artifact["metadata"]["models"][source]
        except (KeyError, TypeError) as error:
            raise ForecastUnavailable(f"Model metadata for {source} is unavailable.") from error
        if not isinstance(metadata, dict):
            raise ForecastUnavailable(f"Model metadata for {source} is invalid.")
        return metadata

    def public_metadata(self) -> dict[str, Any]:
        artifact = self._load()
        result: dict[str, Any] = {}
        for source in ("PSI-159", "PSI-69"):
            spec = self.source_metadata(source)
            result[source] = {
                "features": spec["features"],
                "numeric_features": spec["numeric_features"],
                "model": spec["champion"],
                "prediction_meaning": spec["prediction_meaning"],
                "natural_only": spec["natural_only"],
                "prediction_interval": spec["prediction_interval"],
            }
        return {"sources": result}

    def predict(self, request: BurnTimeForecastRequest) -> BurnTimeForecastResponse:
        artifact = self._load()
        spec = self.source_metadata(request.source)
        features = list(spec.get("features", []))
        numeric_features = set(spec.get("numeric_features", []))
        missing = [name for name in features if request.inputs.get(name) is None]
        unexpected = sorted(set(request.inputs) - set(features))
        if missing or unexpected:
            problems: list[str] = []
            if missing:
                problems.append(f"missing required inputs: {', '.join(missing)}")
            if unexpected:
                problems.append(f"unsupported inputs for {request.source}: {', '.join(unexpected)}")
            raise ValueError("; ".join(problems))

        values: dict[str, str | float] = {}
        for name in features:
            value = request.inputs[name]
            if name in numeric_features:
                if isinstance(value, bool):
                    raise ValueError(f"{name} must be a number")
                try:
                    number = float(value)  # type: ignore[arg-type]
                except (TypeError, ValueError) as error:
                    raise ValueError(f"{name} must be a number") from error
                if not np.isfinite(number):
                    raise ValueError(f"{name} must be finite")
                if name.endswith("_fraction") and not 0 <= number <= 1:
                    raise ValueError(f"{name} must be between 0 and 1")
                if name in {"pressure_bar", "hc_flow_mg_s", "tad_k", "zst", "initial_droplet_diameter_mm"} and number < 0:
                    raise ValueError(f"{name} must not be negative")
                values[name] = number
            elif not isinstance(value, str) or not value.strip():
                raise ValueError(f"{name} must be a non-empty string")
            else:
                values[name] = value.strip()

        if request.source == "PSI-69":
            composition = sum(float(values[name]) for name in ("o2_fraction", "n2_fraction", "co_fraction", "he_fraction"))
            if composition > 1.00001:
                raise ValueError("PSI-69 initial gas fractions must not sum to more than 1")

        try:
            model = artifact["models"][request.source]
            prediction = float(np.asarray(model.predict(pd.DataFrame([values], columns=features)), dtype=float)[0])
        except Exception as error:  # pragma: no cover - model errors depend on the serialized estimator
            logger.exception("Forecast inference failed for %s", request.source)
            raise ForecastUnavailable("Forecast inference failed for the supplied experiment.") from error
        if not np.isfinite(prediction):
            raise ForecastUnavailable("Forecast model returned a non-finite prediction.")

        interval = spec.get("prediction_interval", {})
        try:
            coverage = float(interval["coverage"])
            radius = float(interval["radius_s"])
            method = str(interval["method"])
        except (KeyError, TypeError, ValueError) as error:
            raise ForecastUnavailable("Prediction interval metadata is invalid.") from error
        prediction = max(prediction, 0.0)
        return BurnTimeForecastResponse(
            source=request.source,
            model=str(spec["champion"]),
            prediction_meaning=str(spec["prediction_meaning"]),
            predicted_burn_time_s=prediction,
            interval=PredictionInterval(
                coverage=coverage,
                lower_s=max(prediction - radius, 0.0),
                upper_s=prediction + radius,
                method=method,
            ),
        )


def get_forecast_service(request: Request) -> ForecastService:
    return request.app.state.forecast_service


ForecastDependency = Annotated[ForecastService, Depends(get_forecast_service)]


@router.get("/metadata")
def metadata(service: ForecastDependency) -> dict[str, Any]:
    try:
        return service.public_metadata()
    except ForecastUnavailable as error:
        logger.exception("Forecast metadata is unavailable")
        raise HTTPException(status_code=503, detail=str(error)) from error


@router.post("", response_model=BurnTimeForecastResponse)
def forecast(payload: BurnTimeForecastRequest, service: ForecastDependency) -> BurnTimeForecastResponse:
    try:
        return service.predict(payload)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except ForecastUnavailable as error:
        logger.exception("Forecast service is unavailable")
        raise HTTPException(status_code=503, detail=str(error)) from error
