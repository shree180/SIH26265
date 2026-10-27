"""Negative security tests: tenant isolation, read-only roles, admin guards."""

from conftest import API


def test_cross_institution_record_access_is_blocked(institution_client, nias_client, seeded):
    dit = institution_client.detail("DIT/FDR/2026/001")
    response = nias_client.get(f"/fdrs/{dit['id']}")
    assert response.status_code == 404

    nias_listing = nias_client.get("/fdrs", params={"search": "DIT/FDR/2026/001"})
    assert nias_listing.status_code == 200
    assert nias_listing.json()["total"] == 0
    assert all(
        item["institution"]["institution_code"] == "NIAS" for item in nias_listing.json()["items"]
    )


def test_cross_institution_document_access_is_blocked(institution_client, nias_client, seeded):
    dit = institution_client.detail("DIT/FDR/2026/001")
    document_id = dit["documents"][0]["id"]
    assert nias_client.get(f"/documents/{document_id}").status_code == 404
    assert nias_client.post(f"/documents/{document_id}/extract").status_code == 404


def test_global_roles_can_read_other_institutions(reviewer_client, seeded):
    nias = reviewer_client.detail("NIAS/FDR/2026/101")
    assert nias["institution"]["institution_code"] == "NIAS"
    assert reviewer_client.get(f"/documents/{nias['documents'][0]['id']}").status_code == 200


def test_auditor_is_read_only(auditor_client, seeded):
    target = auditor_client.detail("DIT/FDR/2026/001")
    transition = auditor_client.post(
        f"/fdrs/{target['id']}/transition", json={"action": "MARK_MATURING"}
    )
    assert transition.status_code == 403

    upload = auditor_client.post(
        f"/fdrs/{target['id']}/documents",
        files={"file": ("note.pdf", b"%PDF-1.4 test", "application/pdf")},
    )
    assert upload.status_code == 403

    export = auditor_client.get("/reports/fdrs.csv")
    assert export.status_code == 200


def test_institution_cannot_decide_release(institution_client, seeded):
    listing = institution_client.get("/release-requests", params={"status": "PENDING_CHECKER"})
    assert listing.status_code == 200
    request = listing.json()["items"][0]
    decision = institution_client.post(
        f"/release-requests/{request['id']}/decision",
        json={"decision": "APPROVE", "reason": "Trying to approve my own request."},
    )
    assert decision.status_code == 403


def test_sysadmin_cannot_approve_release_or_edit_financial_state(admin_client, seeded):
    listing = admin_client.get("/release-requests", params={"status": "PENDING_CHECKER"})
    request = listing.json()["items"][0]
    decision = admin_client.post(
        f"/release-requests/{request['id']}/decision",
        json={"decision": "APPROVE", "reason": "Administrative override attempt."},
    )
    assert decision.status_code == 403

    fdr = admin_client.detail("DIT/FDR/2026/001")
    transition = admin_client.post(
        f"/fdrs/{fdr['id']}/transition", json={"action": "START_REVIEW"}
    )
    assert transition.status_code == 403


def test_admin_cannot_change_own_role(admin_client, seeded):
    me = admin_client.get("/me").json()["user"]
    response = admin_client.patch(f"/admin/users/{me['id']}", json={"role": "AUDITOR"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SELF_ADMIN_CHANGE_BLOCKED"


def test_only_admin_can_manage_users(institution_client, seeded):
    assert institution_client.get("/admin/users").status_code == 403
    assert institution_client.patch(
        "/admin/users/does-not-matter", json={"is_active": False}
    ).status_code == 403


def test_institution_cannot_read_another_institutions_audit_events(
    institution_client, nias_client, seeded
):
    nias_fdr = nias_client.detail("NIAS/FDR/2026/101")
    events = institution_client.get("/audit-events", params={"entity_id": nias_fdr["id"]})
    assert events.status_code == 200
    assert events.json()["total"] == 0
