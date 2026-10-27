"""Role workspaces must be distinct, scoped, and computed from stored records.

These assertions tie each role's workspace back to the shared aggregates and to
the caller's actual permissions, so a dashboard can never quietly become a
generic screen or leak another institution's records.
"""

import json

EXPECTED_KIND = {
    "inst.admin@dit.demo": "INSTITUTION",
    "reviewer@fdr.demo": "REVIEWER",
    "checker@fdr.demo": "CHECKER",
    "auditor@fdr.demo": "AUDITOR",
    "sysadmin@fdr.demo": "SYSTEM_ADMIN",
}


def _workspace(client) -> dict:
    response = client.get("/dashboard/summary")
    assert response.status_code == 200, response.text
    body = response.json()
    assert "workspace" in body
    return body


def test_each_role_gets_a_different_workspace(
    institution_client, reviewer_client, checker_client, auditor_client, admin_client, seeded
):
    clients = {
        "inst.admin@dit.demo": institution_client,
        "reviewer@fdr.demo": reviewer_client,
        "checker@fdr.demo": checker_client,
        "auditor@fdr.demo": auditor_client,
        "sysadmin@fdr.demo": admin_client,
    }
    kinds = {}
    titles = set()
    questions = set()
    for email, client in clients.items():
        workspace = _workspace(client)["workspace"]
        kinds[email] = workspace["kind"]
        titles.add(workspace["title"])
        questions.add(workspace["question"])
        assert workspace["role"]
        assert workspace["generated_at"]

    assert kinds == EXPECTED_KIND
    # Five roles, five workspaces: no two accounts share a heading or a question.
    assert len(titles) == 5
    assert len(questions) == 5
    assert all(questions), "every workspace states the question it answers"


def test_institution_workspace_matches_its_shared_metrics(institution_client, seeded):
    body = _workspace(institution_client)
    workspace = body["workspace"]
    metrics = body["metrics"]

    assert workspace["kind"] == "INSTITUTION"
    items = {item["key"]: item for item in workspace["action_items"]}
    assert items["CORRECTION_REQUIRED"]["count"] == metrics["correction_required"]
    assert items["MISSING_EVIDENCE"]["count"] == metrics["missing_evidence"]
    for item in workspace["action_items"]:
        assert item["label"] and item["detail"] and item["to"].startswith("/app")
        assert item["count"] >= 0

    health = workspace["extraction_health"]
    assert health["documents"] >= health["extracted"]
    assert health["unreviewed_fields"] >= 1
    assert workspace["upcoming_maturities"]
    for record in workspace["upcoming_maturities"]:
        assert record["institution"]["institution_code"] == "DIT"
        assert 0 <= record["days_remaining"] <= 30
    for record in workspace["recent_submissions"]:
        assert record["institution"]["institution_code"] == "DIT"


def test_institution_workspace_never_shows_another_institution(nias_client, seeded):
    workspace = _workspace(nias_client)["workspace"]
    serialized = json.dumps(workspace)
    assert "DIT/" not in serialized
    assert "Demo Institute of Technology" not in serialized
    assert "Coastal Polytechnic" not in serialized
    for record in workspace["recent_submissions"]:
        assert record["institution"]["institution_code"] == "NIAS"


def test_workspaces_do_not_expose_other_roles_sections(institution_client, reviewer_client, auditor_client, seeded):
    institution = _workspace(institution_client)["workspace"]
    assert "accounts" not in institution
    assert "awaiting_decision" not in institution
    assert "review_inbox" not in institution
    assert "coverage" not in institution

    reviewer = _workspace(reviewer_client)["workspace"]
    assert "accounts" not in reviewer
    assert "action_items" not in reviewer
    assert "release_requests" not in reviewer

    auditor = _workspace(auditor_client)["workspace"]
    assert "action_items" not in auditor
    assert "awaiting_decision" not in auditor
    assert auditor["read_only"] is True


def test_reviewer_inbox_is_prioritised_with_blocking_reasons(reviewer_client, seeded):
    body = _workspace(reviewer_client)
    workspace = body["workspace"]
    inbox = workspace["review_inbox"]
    assert inbox, "the seeded demo has submissions awaiting a decision"
    assert workspace["counts"]["awaiting_decision"] == body["metrics"]["pending_review"]

    scores = [item["priority"]["score"] for item in inbox]
    assert scores == sorted(scores, reverse=True)
    for item in inbox:
        assert item["lifecycle_status"] in {"SUBMITTED", "UNDER_REVIEW"}
        assert item["id"] in workspace["inbox_reasons"]

    assert workspace["discrepancy_worklist"]
    for item in workspace["discrepancy_worklist"]:
        assert item["unresolved_discrepancies"] >= 1
    assert workspace["counts"]["unresolved_discrepancies"] == len(workspace["discrepancy_worklist"])
    assert workspace["review_sla_hours"] > 0


def test_checker_queue_excludes_own_requests_and_cannot_self_approve(checker_client, seeded):
    body = _workspace(checker_client)
    workspace = body["workspace"]
    me = checker_client.get("/me").json()["user"]

    assert workspace["counts"]["awaiting_your_decision"] == body["metrics"][
        "pending_release_approvals"
    ]
    assert workspace["eligibility"]["self_approval_blocked"] is True
    assert workspace["eligibility"]["requires_manual_verification"] is True
    assert workspace["own_raised_requests"] == []

    for item in workspace["awaiting_decision"]:
        assert item["status"] == "PENDING_CHECKER"
        assert item["maker_id"] != me["id"]
        assert item["maker_name"]
        assert item["reference_number"]
        assert item["age_hours"] >= 0
        assert item["amount"]

    for item in workspace["decided_by_you"]:
        assert item["status"] in {"APPROVED", "RETURNED", "REJECTED"}
        assert item["status_label"]
        assert item["decided_at"]


def test_auditor_workspace_reports_coverage_and_chain_state(auditor_client, seeded):
    body = _workspace(auditor_client)
    workspace = body["workspace"]

    assert workspace["read_only"] is True
    assert workspace["coverage"]["records_in_scope"] == body["metrics"]["total_fdrs"]
    assert workspace["coverage"]["institutions_in_scope"] >= 2
    assert workspace["checks"]["manually_confirmed_records"] >= 1
    for transition in workspace["recent_transitions"]:
        assert transition["action_label"]
        assert transition["actor_label"]
    # Nothing has verified the chain yet in a fresh seed.
    assert workspace["chain_check"]["valid"] is None

    verified = auditor_client.post("/admin/audit/verify-chain")
    assert verified.status_code == 200, verified.text
    assert verified.json()["valid"] is True

    after = _workspace(auditor_client)["workspace"]["chain_check"]
    assert after["valid"] is True
    assert after["checked"] > 0
    assert after["last_checked_at"]


def test_system_admin_workspace_counts_real_accounts_and_flags_integrations(
    admin_client, seeded, settings
):
    body = _workspace(admin_client)
    workspace = body["workspace"]
    accounts = workspace["accounts"]

    assert accounts["total"] == len(seeded["users"])
    assert accounts["active"] == accounts["total"]
    assert accounts["inactive"] == 0
    assert sum(entry["count"] for entry in accounts["by_role"]) == accounts["total"]
    assert accounts["active_sessions"] >= 1

    assert workspace["scheduler"]["enabled"] is settings.scheduler_enabled
    assert workspace["scheduler"]["thresholds"] == settings.thresholds
    assert len(workspace["scheduler"]["thresholds"]) >= 1
    assert workspace["delivery"]["email_configured"] is False

    integrations = {entry["key"]: entry for entry in workspace["integrations"]}
    assert integrations["BANK_VERIFICATION"]["production_ready"] is False
    assert integrations["BANK_VERIFICATION"]["state"] in {"MANUAL", "SIMULATED"}
    assert integrations["EMAIL_DELIVERY"]["state"] == "NOT_CONFIGURED"
    assert integrations["AUDIT_INTEGRITY"]["state"] == "ACTIVE"

    assert workspace["records_in_scope"] == body["metrics"]["total_fdrs"]
    assert workspace["extraction"]["image_ocr_available"] is False
