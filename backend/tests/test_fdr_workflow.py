"""Lifecycle workflow: validation, transitions, review and renewal history."""

from conftest import API


def _payload(reference: str, **overrides) -> dict:
    payload = {
        "reference_number": reference,
        "bank_name": "Test Bank (Demo)",
        "bank_code": "TEST",
        "amount": "1000000.00",
        "issue_date": "2024-01-15",
        "maturity_date": "2027-01-15",
    }
    payload.update(overrides)
    return payload


def test_create_validation(institution_client, seeded):
    assert institution_client.post(
        "/fdrs", json=_payload("DIT/FDR/2026/900", issue_date="2099-01-01")
    ).status_code == 422
    bad_dates = institution_client.post(
        "/fdrs",
        json=_payload("DIT/FDR/2026/901", issue_date="2026-01-10", maturity_date="2026-01-01"),
    )
    assert bad_dates.status_code == 422

    zero = institution_client.post("/fdrs", json=_payload("DIT/FDR/2026/902", amount="0"))
    assert zero.status_code == 422

    duplicate = institution_client.post("/fdrs", json=_payload("DIT/FDR/2026/001"))
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "DUPLICATE_REFERENCE"


def test_reviewer_only_roles_cannot_create(institution_client, reviewer_client, seeded):
    response = reviewer_client.post("/fdrs", json=_payload("REV/FDR/1"))
    assert response.status_code == 403


def test_happy_path_transitions_and_audit(institution_client, reviewer_client, seeded):
    created = institution_client.post("/fdrs", json=_payload("DIT/FDR/2026/910"))
    assert created.status_code == 200
    fdr = created.json()
    assert fdr["lifecycle_status"] == "DRAFT"
    assert fdr["permissions"]["can_edit"] is True

    submitted = institution_client.post(
        f"/fdrs/{fdr['id']}/transition", json={"action": "SUBMIT", "reason": "Ready for review."}
    )
    assert submitted.status_code == 200
    assert submitted.json()["lifecycle_status"] == "SUBMITTED"

    # Institution cannot review its own submission.
    assert institution_client.post(
        f"/fdrs/{fdr['id']}/transition", json={"action": "START_REVIEW"}
    ).status_code == 403

    review = reviewer_client.post(
        f"/fdrs/{fdr['id']}/transition", json={"action": "START_REVIEW"}
    )
    assert review.status_code == 200
    assert review.json()["lifecycle_status"] == "UNDER_REVIEW"

    no_reason = reviewer_client.post(
        f"/fdrs/{fdr['id']}/transition", json={"action": "VERIFY"}
    )
    assert no_reason.status_code == 422

    illegal = reviewer_client.post(
        f"/fdrs/{fdr['id']}/transition", json={"action": "ACTIVATE"}
    )
    assert illegal.status_code == 409
    assert illegal.json()["error"]["code"] == "INVALID_TRANSITION"

    verified = reviewer_client.post(
        f"/fdrs/{fdr['id']}/transition",
        json={"action": "VERIFY", "reason": "Synthetic receipt cross-checked."},
    )
    assert verified.status_code == 200
    verified_body = verified.json()
    assert verified_body["lifecycle_status"] == "VERIFIED"
    assert verified_body["verification_status"] == "MANUAL_CONFIRMED"
    assert verified_body["verification_checks"][0]["method"] == "MANUAL"

    activated = reviewer_client.post(
        f"/fdrs/{fdr['id']}/transition", json={"action": "ACTIVATE"}
    )
    assert activated.status_code == 200
    assert activated.json()["lifecycle_status"] == "ACTIVE"

    actions = [event["action"] for event in activated.json()["workflow_events"]]
    assert "SUBMIT" in actions and "VERIFY" in actions and "ACTIVATE" in actions

    audit = activated.json()["audit_events"]
    assert any(event["action"] == "FDR_TRANSITION" for event in audit)
    assert all(event["event_hash"] for event in audit)


def test_editing_rules_and_stale_version(institution_client, seeded):
    editable = institution_client.detail("DIT/FDR/2026/004")
    stale = institution_client.patch(
        f"/fdrs/{editable['id']}",
        json={"amount": "980000.00", "expected_version": editable["version"] + 5},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "STALE_RECORD"

    updated = institution_client.patch(
        f"/fdrs/{editable['id']}",
        json={"amount": "980000.00", "expected_version": editable["version"]},
    )
    assert updated.status_code == 200
    assert updated.json()["amount"] == "980000.00"
    assert updated.json()["version"] == editable["version"] + 1

    active = institution_client.detail("DIT/FDR/2026/001")
    blocked = institution_client.patch(
        f"/fdrs/{active['id']}", json={"amount": "1.00", "expected_version": active["version"]}
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "NOT_EDITABLE"


def test_rejection_requires_reason(reviewer_client, seeded):
    target = reviewer_client.detail("DIT/FDR/2026/003")
    missing = reviewer_client.post(
        f"/fdrs/{target['id']}/transition", json={"action": "REJECT"}
    )
    assert missing.status_code == 422
    rejected = reviewer_client.post(
        f"/fdrs/{target['id']}/transition",
        json={"action": "REJECT", "reason": "Receipt does not match any submitted detail."},
    )
    assert rejected.status_code == 200
    assert rejected.json()["lifecycle_status"] == "REJECTED"


def test_renewal_preserves_predecessor_history(institution_client, reviewer_client, seeded):
    predecessor = institution_client.detail("DIT/FDR/2026/001")
    response = institution_client.post(
        f"/fdrs/{predecessor['id']}/renewals",
        json={
            "relationship_type": "RENEWAL",
            "reason": "Deposit renewed for another year with the same bank.",
            "new_fdr": {
                "reference_number": "DIT/FDR/2026/920",
                "bank_name": "State Bank of India (Demo)",
                "amount": "1300000.00",
                "issue_date": "2026-01-01",
                "maturity_date": "2027-01-01",
            },
        },
    )
    assert response.status_code == 200, response.text
    successor_id = response.json()["successor_id"]

    old_after = institution_client.detail("DIT/FDR/2026/001")
    assert old_after["lifecycle_status"] == "RENEWAL_PENDING"
    assert old_after["renewal"]["successors"][0]["id"] == successor_id

    reviewer_client.post(f"/fdrs/{successor_id}/transition", json={"action": "START_REVIEW"})
    verified = reviewer_client.post(
        f"/fdrs/{successor_id}/transition",
        json={"action": "VERIFY", "reason": "Renewal receipt checked."},
    )
    assert verified.status_code == 200

    old_final = institution_client.detail("DIT/FDR/2026/001")
    assert old_final["lifecycle_status"] == "REPLACED"
    new_final = institution_client.detail("DIT/FDR/2026/920")
    assert new_final["renewal"]["predecessor"]["id"] == predecessor["id"]


def test_duplicate_renewal_reference_is_rejected(institution_client, seeded):
    predecessor = institution_client.detail("DIT/FDR/2026/001")
    response = institution_client.post(
        f"/fdrs/{predecessor['id']}/renewals",
        json={
            "relationship_type": "REPLACEMENT",
            "reason": "Replacing the receipt with a corrected instrument.",
            "new_fdr": {
                "reference_number": "DIT/FDR/2026/006",
                "bank_name": "State Bank of India (Demo)",
                "amount": "1300000.00",
                "issue_date": "2026-01-01",
                "maturity_date": "2027-01-01",
            },
        },
    )
    assert response.status_code == 409


def test_search_and_filter_are_server_side(institution_client, seeded):
    released = institution_client.get("/fdrs", params={"status": "RELEASED"})
    assert released.status_code == 200
    assert released.json()["total"] == 1
    assert released.json()["items"][0]["reference_number"] == "DIT/FDR/2026/009"

    search = institution_client.get("/fdrs", params={"search": "2026/007"})
    assert search.json()["total"] == 1

    priority_sorted = institution_client.get(
        "/fdrs", params={"sort": "priority_desc", "page_size": 5}
    )
    scores = [item["priority"]["score"] for item in priority_sorted.json()["items"]]
    assert scores == sorted(scores, reverse=True)
    assert priority_sorted.json()["computed_in_memory"] is True


def test_pagination_bounds(institution_client, seeded):
    first = institution_client.get("/fdrs", params={"page": 1, "page_size": 4})
    second = institution_client.get("/fdrs", params={"page": 2, "page_size": 4})
    assert first.json()["total"] == second.json()["total"]
    ids_first = {item["id"] for item in first.json()["items"]}
    ids_second = {item["id"] for item in second.json()["items"]}
    assert ids_first.isdisjoint(ids_second)
