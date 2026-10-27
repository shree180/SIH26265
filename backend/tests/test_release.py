"""Maker-checker release workflow and separation-of-duties guard."""

from app.models import ReleaseRequest, User


def _pending_request(client) -> dict:
    listing = client.get("/release-requests", params={"status": "PENDING_CHECKER"})
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert items, "expected a seeded pending release request"
    return items[0]


def test_duplicate_release_request_is_blocked(institution_client, seeded):
    fdr = institution_client.detail("DIT/FDR/2026/005")
    response = institution_client.post(
        "/release-requests",
        json={
            "fdr_id": fdr["id"],
            "request_reason": "Attempting a second release request for the same record.",
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DUPLICATE_RELEASE_REQUEST"


def test_checker_approves_and_state_becomes_released(
    institution_client, checker_client, seeded
):
    request = _pending_request(checker_client)
    fdr_id = request["fdr_id"]

    decision = checker_client.post(
        f"/release-requests/{request['id']}/decision",
        json={
            "decision": "APPROVE",
            "reason": "Evidence reviewed; release approved in this system only.",
        },
    )
    assert decision.status_code == 200, decision.text
    assert decision.json()["status"] == "APPROVED"
    assert decision.json()["checker"]["email"] == "checker@fdr.demo"
    assert decision.json()["requested_by"]["email"] == "inst.admin@dit.demo"

    detail = institution_client.get(f"/fdrs/{fdr_id}").json()
    assert detail["lifecycle_status"] == "RELEASED"
    assert detail["released_at"] is not None
    assert detail["released_by"] == "Rahul Menon"

    repeat = checker_client.post(
        f"/release-requests/{request['id']}/decision",
        json={"decision": "APPROVE", "reason": "Second attempt after approval."},
    )
    assert repeat.status_code == 409
    assert repeat.json()["error"]["code"] == "ALREADY_DECIDED"


def test_self_approval_is_blocked(app, checker_client, seeded):
    request = _pending_request(checker_client)
    checker_me = checker_client.get("/me").json()["user"]

    # Simulate the one case the role model otherwise prevents structurally:
    # the checker is also recorded as the maker. The API must still refuse.
    with app.state.SessionLocal() as db:
        row = db.get(ReleaseRequest, request["id"])
        checker_user = db.get(User, checker_me["id"])
        row.requested_by = checker_user.id
        db.commit()

    response = checker_client.post(
        f"/release-requests/{request['id']}/decision",
        json={"decision": "APPROVE", "reason": "Approving my own request."},
    )
    assert response.status_code == 403
    assert "Maker-checker" in response.json()["error"]["message"]


def test_simulated_verification_cannot_unlock_release(institution_client, app, seeded):
    fdr = institution_client.detail("DIT/FDR/2026/001")
    from app.models import FdrRecord

    with app.state.SessionLocal() as db:
        row = db.get(FdrRecord, fdr["id"])
        row.verification_status = "SIMULATION_ONLY"
        db.commit()

    response = institution_client.post(
        "/release-requests",
        json={
            "fdr_id": fdr["id"],
            "request_reason": "Release requested after a simulated provider check.",
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VERIFICATION_REQUIRED"


def test_release_request_requires_verified_record(institution_client, seeded):
    draft = institution_client.detail("DIT/FDR/2026/004")
    response = institution_client.post(
        "/release-requests",
        json={
            "fdr_id": draft["id"],
            "request_reason": "Release requested for a record still awaiting correction.",
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "INVALID_TRANSITION"


def test_release_request_is_institution_scoped(institution_client, nias_client, seeded):
    nias_fdr = nias_client.detail("NIAS/FDR/2026/101")
    response = institution_client.post(
        "/release-requests",
        json={
            "fdr_id": nias_fdr["id"],
            "request_reason": "Attempting a cross-institution release request.",
        },
    )
    assert response.status_code == 404
