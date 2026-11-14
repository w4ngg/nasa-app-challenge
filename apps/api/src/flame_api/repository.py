"""Read an atomically published JSON catalog; replace this adapter for a database."""
from pathlib import Path

from .models import Catalog


class CatalogRepository:
    def __init__(self, path: Path):
        self.path = path

    def read(self) -> Catalog:
        if not self.path.exists():
            return Catalog()
        return Catalog.model_validate_json(self.path.read_text(encoding="utf-8"))
