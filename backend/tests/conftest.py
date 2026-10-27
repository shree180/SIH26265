"""Test fixtures: isolated database, seeded demo data, cookie-aware clients."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.seed import seed  # noqa: E402

API = "/api/v1"
DEMO_PASSWORD = "Sentinel#2026"


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(
        app_env="test",
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        upload_dir=str(tmp_path / "uploads"),
        jwt_secret_key="test-secret-key-for-fixtures-only-0123456789",
        scheduler_enabled=False,
        scan_on_startup=False,
        frontend_origin="http://localhost:5173",
        login_max_attempts=5,
        login_lockout_minutes=5,
        demo_password=DEMO_PASSWORD,
    )


@pytest.fixture()
def app(settings):
    return create_app(settings, start_scheduler=False)


@pytest.fixture()
def seeded(app, settings):
    with app.state.SessionLocal() as db:
        summary = seed(db, settings, password=DEMO_PASSWORD)
    return summary


class Api:
    """Small client wrapper that keeps the CSRF header in sync."""

    def __init__(self, app):
        self.client = TestClient(app)
        self.csrf: str | None = None

    def login(self, email: str, password: str = DEMO_PASSWORD):
        response = self.client.post(
            f"{API}/auth/login", json={"email": email, "password": password}
        )
        assert response.status_code == 200, response.text
        self.csrf = response.json()["csrf_token"]
        self.client.headers.update({"X-CSRF-Token": self.csrf})
        return response.json()

    def get(self, path: str, **kwargs):
        return self.client.get(f"{API}{path}", **kwargs)

    def post(self, path: str, **kwargs):
        return self.client.post(f"{API}{path}", **kwargs)

    def patch(self, path: str, **kwargs):
        return self.client.patch(f"{API}{path}", **kwargs)

    def detail(self, reference: str) -> dict:
        listing = self.get("/fdrs", params={"search": reference, "page_size": 50})
        assert listing.status_code == 200, listing.text
        items = [item for item in listing.json()["items"] if item["reference_number"] == reference]
        assert items, f"{reference} not found for this scope"
        detail = self.get(f"/fdrs/{items[0]['id']}")
        assert detail.status_code == 200, detail.text
        return detail.json()


@pytest.fixture()
def make_client(app):
    def _make() -> Api:
        return Api(app)

    return _make


@pytest.fixture()
def institution_client(make_client, seeded) -> Api:
    client = make_client()
    client.login("inst.admin@dit.demo")
    return client


@pytest.fixture()
def nias_client(make_client, seeded) -> Api:
    client = make_client()
    client.login("inst.admin@nias.demo")
    return client


@pytest.fixture()
def reviewer_client(make_client, seeded) -> Api:
    client = make_client()
    client.login("reviewer@fdr.demo")
    return client


@pytest.fixture()
def checker_client(make_client, seeded) -> Api:
    client = make_client()
    client.login("checker@fdr.demo")
    return client


@pytest.fixture()
def auditor_client(make_client, seeded) -> Api:
    client = make_client()
    client.login("auditor@fdr.demo")
    return client


@pytest.fixture()
def admin_client(make_client, seeded) -> Api:
    client = make_client()
    client.login("sysadmin@fdr.demo")
    return client
