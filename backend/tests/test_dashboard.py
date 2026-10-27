"""Dashboard aggregates must come from stored, role-scoped records."""


def test_metrics_are_scoped_and_stored(institution_client, nias_client, admin_client, seeded):
    dit = institution_client.get("/dashboard/summary").json()
    assert dit["metrics"]["total_fdrs"] == 10
    assert dit["scope"]["institution"]["institution_code"] == "DIT"
    assert dit["metrics"]["overdue"] >= 1
    assert dit["metrics"]["discrepancies"] >= 1
    assert dit["metrics"]["pending_release_approvals"] == 1
    assert dit["metrics"]["own_pending_release_requests"] == 1

    nias = nias_client.get("/dashboard/summary").json()
    assert nias["metrics"]["total_fdrs"] == 1

    everything = admin_client.get("/dashboard/summary").json()
    assert everything["metrics"]["total_fdrs"] == 11
    assert everything["scope"]["is_global"] is True


def test_needs_attention_is_priority_ordered(institution_client, seeded):
    body = institution_client.get("/dashboard/summary").json()
    attention = body["needs_attention"]
    assert attention
    scores = [item["priority"]["score"] for item in attention]
    assert scores == sorted(scores, reverse=True)
    for item in attention:
        assert item["priority"]["summary"]
        assert isinstance(item["priority"]["factors"], list)


def test_approver_sees_only_requests_they_can_decide(checker_client, seeded):
    body = checker_client.get("/dashboard/summary").json()
    assert body["metrics"]["pending_release_approvals"] == 1
    assert body["metrics"]["own_pending_release_requests"] == 0


def test_dashboard_uses_configured_business_date(institution_client, seeded):
    body = institution_client.get("/dashboard/summary").json()
    assert body["business_date"]
    assert body["maturity_buckets"]
    assert sum(bucket["count"] for bucket in body["maturity_buckets"]) >= 1
