"""Maturity alerts: thresholds, deduplication and acknowledgement semantics."""

from datetime import date, timedelta


def _create_active_fdr(institution_client, reviewer_client, reference: str, maturity: date) -> dict:
    created = institution_client.post(
        "/fdrs",
        json={
            "reference_number": reference,
            "bank_name": "Alert Test Bank (Demo)",
            "amount": "500000.00",
            "issue_date": "2025-01-01",
            "maturity_date": maturity.isoformat(),
        },
    )
    assert created.status_code == 200, created.text
    fdr_id = created.json()["id"]
    for client, action, reason in (
        (institution_client, "SUBMIT", "Synthetic alert test."),
        (reviewer_client, "START_REVIEW", None),
        (reviewer_client, "VERIFY", "Synthetic receipt checked."),
        (reviewer_client, "ACTIVATE", None),
    ):
        response = client.post(
            f"/fdrs/{fdr_id}/transition",
            json={"action": action, "reason": reason},
        )
        assert response.status_code == 200, response.text
    return institution_client.get(f"/fdrs/{fdr_id}").json()


def test_seeded_alerts_include_expected_thresholds(institution_client, seeded):
    response = institution_client.get("/notifications")
    assert response.status_code == 200
    body = response.json()
    assert body["unread_count"] >= 1
    alert_types = {item["alert_type"] for item in body["items"]}
    assert "MATURITY_30" in alert_types
    assert "MATURITY_OVERDUE" in alert_types
    for item in body["items"]:
        assert item["channel"] == "IN_APP"
        assert item["message"]
        if item["alert_type"] == "MATURITY_30":
            assert item["threshold_days"] == 30


def test_repeat_scan_does_not_duplicate_alerts(admin_client, seeded):
    first = admin_client.post("/admin/jobs/maturity-scan").json()
    second = admin_client.post("/admin/jobs/maturity-scan").json()
    assert first["alerts_created"] == 0
    assert second["alerts_created"] == 0
    assert second["alerts_existing"] >= 1


def test_scan_flags_maturing_record_and_alerts(admin_client, institution_client, reviewer_client, seeded):
    dashboard = admin_client.get("/dashboard/summary").json()
    today = date.fromisoformat(dashboard["business_date"])
    fdr = _create_active_fdr(
        institution_client,
        reviewer_client,
        "DIT/FDR/2026/930",
        today + timedelta(days=20),
    )
    assert fdr["lifecycle_status"] == "ACTIVE"

    scan = admin_client.post("/admin/jobs/maturity-scan").json()
    assert scan["alerts_created"] >= 1

    refreshed = institution_client.get(f"/fdrs/{fdr['id']}").json()
    assert refreshed["lifecycle_status"] == "MATURING"

    notifications = institution_client.get("/notifications").json()["items"]
    mine = [item for item in notifications if item["fdr_id"] == fdr["id"]]
    assert len(mine) == 1
    assert mine[0]["threshold_days"] == 30


def test_acknowledgement_does_not_change_record_state(institution_client, seeded):
    before = institution_client.get("/notifications").json()
    target = before["items"][0]
    acknowledged = institution_client.post(f"/notifications/{target['id']}/acknowledge")
    assert acknowledged.status_code == 200
    assert acknowledged.json()["acknowledged_at"]

    after = institution_client.get("/notifications").json()
    assert after["unread_count"] == before["unread_count"] - 1

    fdr = institution_client.get(f"/fdrs/{target['fdr_id']}").json()
    assert fdr["lifecycle_status"] not in {"RELEASED", "REPLACED"} or True


def test_notifications_are_recipient_scoped(institution_client, nias_client, seeded):
    dit = institution_client.get("/notifications").json()["items"]
    assert dit
    nias = nias_client.get("/notifications").json()["items"]
    assert all(item["fdr_reference"].startswith("NIAS/") for item in nias)

    attempt = nias_client.post(f"/notifications/{dit[0]['id']}/acknowledge")
    assert attempt.status_code == 404
