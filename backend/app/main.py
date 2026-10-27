"""FDR Sentinel API application factory."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from . import models  # noqa: F401 - ensure metadata is registered
from .config import Settings, get_settings
from .database import Base, build_engine, build_session_factory
from .errors import register_error_handlers
from .routers import (
    admin,
    audit,
    auth,
    dashboard,
    documents,
    fdrs,
    institutions,
    meta,
    notifications,
    release_requests,
    reports,
)
from .security import LoginThrottle
from .services.notifications import run_maturity_scan

logger = logging.getLogger("fdr_sentinel")


def _scheduled_scan(session_factory, settings: Settings) -> None:
    try:
        with session_factory() as db:
            result = run_maturity_scan(db, settings)
        logger.info(
            "maturity scan complete: scanned=%s created=%s existing=%s",
            result["scanned"],
            result["alerts_created"],
            result["alerts_existing"],
        )
    except Exception:  # pragma: no cover - background job guard
        logger.exception("maturity scan failed")


def create_app(
    settings: Settings | None = None, *, start_scheduler: bool = True
) -> FastAPI:
    settings = settings or get_settings()
    settings.validate_for_startup()
    settings.ensure_directories()

    engine = build_engine(settings.database_url)
    SessionLocal = build_session_factory(engine)
    Base.metadata.create_all(engine)

    scheduler: BackgroundScheduler | None = None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        nonlocal scheduler
        if settings.scheduler_enabled and start_scheduler:
            if settings.scan_on_startup:
                try:
                    with SessionLocal() as db:
                        result = run_maturity_scan(db, settings)
                    logger.info("startup maturity scan: %s", result)
                except Exception:  # pragma: no cover - startup guard
                    logger.exception("startup maturity scan failed")
            scheduler = BackgroundScheduler(timezone="UTC")
            scheduler.add_job(
                _scheduled_scan,
                CronTrigger(hour=settings.maturity_scan_hour_utc, minute=0),
                args=[SessionLocal, settings],
                id="maturity_scan",
                replace_existing=True,
                coalesce=True,
                max_instances=1,
            )
            scheduler.start()
            logger.info("maturity scheduler started (daily %02d:00 UTC)", settings.maturity_scan_hour_utc)
        try:
            yield
        finally:
            if scheduler is not None:
                scheduler.shutdown(wait=False)
            engine.dispose()

    app = FastAPI(
        title="FDR Sentinel API",
        version="1.0.0",
        description=(
            "Prototype API for FDR lifecycle, review, alerts and maker-checker release. "
            "Synthetic data only; no bank integration."
        ),
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.SessionLocal = SessionLocal
    app.state.login_throttle = LoginThrottle(
        max_attempts=settings.login_max_attempts,
        lockout_minutes=settings.login_lockout_minutes,
    )

    register_error_handlers(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
        expose_headers=["Content-Disposition", "X-Exported-Rows", "X-Export-Truncated"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), camera=(), microphone=()"
        )
        if request.url.path.startswith("/api"):
            response.headers.setdefault("Cache-Control", "no-store")
        if settings.cookie_secure:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response

    @app.exception_handler(Exception)
    async def unhandled_exception(_request: Request, exc: Exception):
        logger.exception("unhandled error: %s", exc)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "Something went wrong. Try again or contact an administrator.",
                }
            },
        )

    prefix = settings.api_prefix
    for router in (
        auth.router,
        auth.me_router,
        institutions.router,
        fdrs.router,
        documents.router,
        release_requests.router,
        notifications.router,
        dashboard.router,
        reports.router,
        audit.router,
        admin.router,
        meta.router,
    ):
        app.include_router(router, prefix=prefix)

    @app.get(f"{prefix}/health", tags=["meta"])
    def health():
        database_status = "ok"
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except Exception:
            logger.exception("database health check failed")
            database_status = "unavailable"
        return {
            "status": "ok" if database_status == "ok" else "degraded",
            "database": database_status,
            "environment": settings.app_env,
        }

    dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if dist.is_dir():
        assets = dist / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            if full_path.startswith("api/"):
                return JSONResponse(status_code=404, content={"error": {"code": "NOT_FOUND", "message": "Not found."}})
            candidate = (dist / full_path).resolve()
            if full_path and candidate.is_file() and str(candidate).startswith(str(dist.resolve())):
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")

    return app
