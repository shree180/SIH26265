"""Audit-chain integrity, tamper detection and export auditing."""

from sqlalchemy import text


def test_audit_chain_verifies(admin_client, seeded):
    response = admin_client.post("/admin/audit/verify-chain")
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is True
    assert body["checked"] > 0
    assert "immutability" in body["limitation"]


def test_audit_events_are_hash_linked(admin_client, seeded):
    listing = admin_client.get("/audit-events", params={"page_size": 100}).json()
    ordered = sorted(listing["items"], key=lambda item: item["sequence"])
    assert ordered[0]["previous_hash"] == "0" * 64
    for previous, current in zip(ordered, ordered[1:]):
        assert current["previous_hash"] == previous["event_hash"]


def test_tampering_is_detected(app, admin_client, seeded):
    with app.state.SessionLocal() as db:
        db.execute(
            text("UPDATE audit_events SET event_payload = :payload WHERE sequence = 3"),
            {"payload": '{"tampered":true}'},
        )
        db.commit()

    response = admin_client.post("/admin/audit/verify-chain")
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert body["broken_sequence"] == 3
    assert "hash" in (body["reason"] or "").lower()


def test_auditor_can_verify_chain_but_not_export_admin_data(auditor_client, seeded):
    assert auditor_client.post("/admin/audit/verify-chain").status_code == 200
    assert auditor_client.get("/admin/users").status_code == 403


def test_export_is_audited(institution_client, seeded):
    assert institution_client.get("/reports/fdrs.csv").status_code == 200
    events = institution_client.get(
        "/audit-events", params={"action": "EXPORT_FDRS"}
    ).json()
    assert events["total"] == 1
    assert events["items"][0]["payload"]["row_count"] == len(seeded["fdrs"]) - 2


def test_institution_audit_is_scoped(institution_client, seeded):
    listing = institution_client.get("/audit-events", params={"page_size": 100}).json()
    assert listing["total"] > 0
    for item in listing["items"]:
        if item["entity_type"] == "FDR":
            assert item["entity_label"].startswith("DIT/")
        else:
            assert item["entity_type"] == "USER"


def test_system_admin_sees_all_audit_events(admin_client, seeded):
    everything = admin_client.get("/audit-events", params={"page_size": 100}).json()
    labels = {item["entity_label"] for item in everything["items"] if item["entity_label"]}
    assert any(label.startswith("DIT/") for label in labels)
    assert any(label.startswith("NIAS/") for label in labels)
