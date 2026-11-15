"""Local configuration; environment variables override the optional root .env."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


@dataclass(frozen=True)
class Settings:
    catalog_path: Path
    cors_origins: tuple[str, ...]
    forecast_model_path: Path = REPOSITORY_ROOT / "ml_modelling" / "psi159_psi69_source_specific_burn_time_models.joblib"

    @classmethod
    def from_environment(cls) -> "Settings":
        load_dotenv(REPOSITORY_ROOT / ".env", override=False)
        path = Path(os.getenv("FLAME_CATALOG_PATH", "data/processed/catalog.json"))
        if not path.is_absolute():
            path = REPOSITORY_ROOT / path
        model_path = Path(os.getenv(
            "FLAME_FORECAST_MODEL_PATH",
            "ml_modelling/psi159_psi69_source_specific_burn_time_models.joblib",
        ))
        if not model_path.is_absolute():
            model_path = REPOSITORY_ROOT / model_path
        origins = os.getenv(
            "FLAME_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        )
        return cls(path, tuple(x.strip() for x in origins.split(",") if x.strip()), model_path)
