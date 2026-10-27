"""Authentication, session rotation and CSRF behaviour."""

from conftest import API, DEMO_PASSWORD


def test_login_returns_user_and_csrf(make_client, seeded):
    client = make_client()
    payload = client.login("inst.admin@dit.demo")
    assert payload["user"]["role"] == "INSTITUTION_ADMIN"
    assert payload["user"]["institution"]["institution_code"] == "DIT"
    assert payload["csrf_token"]
    assert client.client.cookies.get("fdr_access")
    assert client.client.cookies.get("fdr_refresh")

    me = client.get("/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "inst.admin@dit.demo"
    assert me.json()["capabilities"]["can_submit"] is True


def test_login_rejects_bad_credentials_generically(make_client, seeded):
    client = make_client()
    response = client.client.post(
        f"{API}/auth/login", json={"email": "inst.admin@dit.demo", "password": "wrong-password"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "INVALID_CREDENTIALS"
    assert "incorrect" in response.json()["error"]["message"].lower()

    unknown = client.client.post(
        f"{API}/auth/login", json={"email": "nobody@nowhere.demo", "password": "whatever"}
    )
    assert unknown.status_code == 401
    assert unknown.json()["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_is_rate_limited(make_client, seeded):
    client = make_client()
    for _ in range(5):
        response = client.client.post(
            f"{API}/auth/login",
            json={"email": "reviewer@fdr.demo", "password": "definitely-wrong"},
        )
        assert response.status_code == 401
    blocked = client.client.post(
        f"{API}/auth/login",
        json={"email": "reviewer@fdr.demo", "password": "definitely-wrong"},
    )
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] in {"TOO_MANY_ATTEMPTS", "ACCOUNT_LOCKED"}


def test_unauthenticated_and_csrf_protection(make_client, seeded):
    anonymous = make_client()
    assert anonymous.get("/fdrs").status_code == 401

    client = make_client()
    client.login("inst.admin@dit.demo")
    del client.client.headers["X-CSRF-Token"]
    blocked = client.client.post(
        f"{API}/fdrs",
        json={
            "reference_number": "DIT/FDR/2026/900",
            "bank_name": "Demo Bank",
            "amount": "1000.00",
            "issue_date": "2026-01-01",
            "maturity_date": "2027-01-01",
        },
    )
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "CSRF_FAILED"


def test_refresh_rotates_csrf_and_token(make_client, seeded):
    client = make_client()
    first = client.login("auditor@fdr.demo")
    old_csrf = first["csrf_token"]
    old_refresh = client.client.cookies.get("fdr_refresh")

    refreshed = client.post("/auth/refresh")
    assert refreshed.status_code == 200
    new_csrf = refreshed.json()["csrf_token"]
    assert new_csrf != old_csrf
    assert client.client.cookies.get("fdr_refresh") != old_refresh

    client.csrf = new_csrf
    client.client.headers.update({"X-CSRF-Token": new_csrf})
    assert client.get("/me").status_code == 200


def test_logout_revokes_session(make_client, seeded):
    client = make_client()
    client.login("inst.admin@nias.demo")
    assert client.post("/auth/logout").status_code == 200
    assert client.get("/me").status_code == 401


def test_inactive_account_cannot_sign_in(make_client, app, seeded):
    from app.models import User

    with app.state.SessionLocal() as db:
        user = db.query(User).filter(User.email == "auditor@fdr.demo").one()
        user.is_active = False
        db.commit()

    client = make_client()
    response = client.client.post(
        f"{API}/auth/login", json={"email": "auditor@fdr.demo", "password": DEMO_PASSWORD}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "ACCOUNT_UNAVAILABLE"
