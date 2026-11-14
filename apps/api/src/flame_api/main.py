from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import Settings
from .repository import CatalogRepository
from .routes.catalog import router
from .routes.forecast import ForecastService, router as forecast_router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_environment()
    app = FastAPI(
        title="Flame Atlas API", version=__version__,
        description="NASA PSI investigation and publication metadata. SI insights are a planned extension.",
    )
    app.state.catalog_repository = CatalogRepository(settings.catalog_path)
    app.state.forecast_service = ForecastService(settings.forecast_model_path)
    app.add_middleware(
        CORSMiddleware, allow_origins=list(settings.cors_origins),
        allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Accept", "Content-Type"],
    )

    @app.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    app.include_router(router)
    app.include_router(forecast_router)
    return app


app = create_app()
