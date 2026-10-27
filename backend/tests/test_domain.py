"""Pure business-rule tests: priority scoring, maturity buckets, money parsing."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.domain import (
    LifecycleStatus,
    allowed_actions,
    compute_priority,
    maturity_bucket,
    transition_for,
)
from app.money import (
    decimal_to_paise,
    paise_to_decimal_string,
    parse_extracted_amount,
    parse_extracted_date,
    validate_amount,
)
from app.services.notifications import threshold_bucket

TODAY = date(2026, 6, 15)


def _priority(**overrides):
    defaults = dict(
        lifecycle_status=LifecycleStatus.ACTIVE.value,
        maturity_date=TODAY + timedelta(days=200),
        today=TODAY,
        has_documents=True,
        unresolved_discrepancies=0,
    )
    defaults.update(overrides)
    return compute_priority(**defaults)


def test_priority_uses_only_highest_maturity_bucket():
    result = _priority(maturity_date=TODAY + timedelta(days=5))
    maturity_factors = [f for f in result.factors if f.code.startswith("MATURITY")]
    assert [f.code for f in maturity_factors] == ["MATURITY_WITHIN_7"]
    assert result.score == 30
    assert "matures in 5 day(s)" in result.summary


def test_priority_overdue_and_cap():
    result = _priority(
        maturity_date=TODAY - timedelta(days=3),
        has_documents=False,
        unresolved_discrepancies=2,
        review_overdue=True,
        approval_overdue=True,
    )
    assert result.score == 100  # 40 + 15 + 20 + 10 + 20 = 105, capped
    codes = {f.code for f in result.factors}
    assert codes == {
        "MATURITY_OVERDUE",
        "MISSING_DOCUMENT",
        "UNRESOLVED_DISCREPANCY",
        "REVIEW_OVERDUE",
        "APPROVAL_OVERDUE",
    }


def test_priority_ignores_maturity_for_closed_records():
    result = _priority(
        lifecycle_status=LifecycleStatus.RELEASED.value,
        maturity_date=TODAY - timedelta(days=10),
    )
    assert result.score == 0
    assert result.summary.startswith("Priority 0")


@pytest.mark.parametrize(
    "days,expected",
    [(-1, "OVERDUE"), (0, "WITHIN_7"), (7, "WITHIN_7"), (8, "WITHIN_15"),
     (15, "WITHIN_15"), (16, "WITHIN_30"), (30, "WITHIN_30"), (31, None)],
)
def test_maturity_bucket_boundaries(days, expected):
    assert maturity_bucket(days, [30, 15, 7]) == expected


@pytest.mark.parametrize(
    "days,expected", [(-1, None), (0, 7), (7, 7), (8, 15), (15, 15), (16, 30), (30, 30), (31, None)]
)
def test_alert_threshold_boundaries(days, expected):
    assert threshold_bucket(days, [30, 15, 7]) == expected


def test_money_is_exact_and_rounded_half_up():
    assert decimal_to_paise(Decimal("1250000.00")) == 125000000
    assert paise_to_decimal_string(125000000) == "1250000.00"
    assert decimal_to_paise(Decimal("0.005")) == 1
    assert validate_amount(Decimal("10.5")) == 1050
    with pytest.raises(Exception):
        validate_amount(Decimal("0"))


@pytest.mark.parametrize(
    "text,expected",
    [
        ("INR 1,250,000.00", 125000000),
        ("Rs. 4,80,000", 48000000),
        ("975000.5", 97500050),
        ("not an amount", None),
        (None, None),
    ],
)
def test_extracted_amount_parsing(text, expected):
    assert parse_extracted_amount(text) == expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("2026-03-01", date(2026, 3, 1)),
        ("01/03/2026", date(2026, 3, 1)),
        ("1 March 2026", date(2026, 3, 1)),
        ("garbage", None),
    ],
)
def test_extracted_date_parsing(text, expected):
    assert parse_extracted_date(text) == expected


def test_transition_rules_are_role_scoped():
    assert allowed_actions("DRAFT", "INSTITUTION_ADMIN") == ["SUBMIT"]
    assert allowed_actions("DRAFT", "REVIEWING_OFFICER") == []
    assert transition_for("verify").reason_required is True
    assert transition_for("SUBMIT").to_state == "SUBMITTED"
    assert transition_for("televise") is None
