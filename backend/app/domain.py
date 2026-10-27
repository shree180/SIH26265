"""Domain rules: roles, lifecycle state machine, priority scoring, date policy.

Everything that makes a financial or workflow decision lives here so the API
layer can stay thin and the rules can be unit tested directly.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo


class Role(str, enum.Enum):
    INSTITUTION_ADMIN = "INSTITUTION_ADMIN"
    REVIEWING_OFFICER = "REVIEWING_OFFICER"
    APPROVING_OFFICER = "APPROVING_OFFICER"
    AUDITOR = "AUDITOR"
    SYSTEM_ADMIN = "SYSTEM_ADMIN"


class InstitutionRole(str, enum.Enum):
    """Roles that read/write a single institution's records."""


GLOBAL_ROLES = {
    Role.REVIEWING_OFFICER.value,
    Role.APPROVING_OFFICER.value,
    Role.AUDITOR.value,
    Role.SYSTEM_ADMIN.value,
}

INSTITUTION_ROLES = {Role.INSTITUTION_ADMIN.value}

READ_ONLY_ROLES = {Role.AUDITOR.value}


class LifecycleStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    UNDER_REVIEW = "UNDER_REVIEW"
    CORRECTION_REQUIRED = "CORRECTION_REQUIRED"
    REJECTED = "REJECTED"
    VERIFIED = "VERIFIED"
    ACTIVE = "ACTIVE"
    MATURING = "MATURING"
    RENEWAL_PENDING = "RENEWAL_PENDING"
    REPLACED = "REPLACED"
    RELEASE_REQUESTED = "RELEASE_REQUESTED"
    PENDING_CHECKER = "PENDING_CHECKER"
    RELEASED = "RELEASED"
    EXPIRED = "EXPIRED"


class VerificationStatus(str, enum.Enum):
    UNVERIFIED = "UNVERIFIED"
    MANUAL_CONFIRMED = "MANUAL_CONFIRMED"
    SIMULATION_ONLY = "SIMULATION_ONLY"
    MISMATCH_REPORTED = "MISMATCH_REPORTED"
    FAILED_VERIFICATION = "FAILED_VERIFICATION"


class ReleaseStatus(str, enum.Enum):
    PENDING_CHECKER = "PENDING_CHECKER"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    RETURNED = "RETURNED"


class ReleaseDecision(str, enum.Enum):
    APPROVE = "APPROVE"
    REJECT = "REJECT"
    RETURN = "RETURN"


class VerificationMethod(str, enum.Enum):
    MANUAL = "MANUAL"
    PROVIDER = "PROVIDER"


class DiscrepancyStatus(str, enum.Enum):
    MATCH = "MATCH"
    MISMATCH = "MISMATCH"
    MISSING_IN_DOCUMENT = "MISSING_IN_DOCUMENT"
    MISSING_IN_SUBMISSION = "MISSING_IN_SUBMISSION"
    REVIEWED_MATCH = "REVIEWED_MATCH"
    REVIEWED_OVERRIDE = "REVIEWED_OVERRIDE"
    DISMISSED = "DISMISSED"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"


class ExtractionStatus(str, enum.Enum):
    PENDING = "PENDING"
    EXTRACTED = "EXTRACTED"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    UNAVAILABLE = "UNAVAILABLE"
    NO_TEXT_LAYER = "NO_TEXT_LAYER"
    FAILED = "FAILED"


class ScanStatus(str, enum.Enum):
    NOT_SCANNED = "NOT_SCANNED"


class ReviewStatus(str, enum.Enum):
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    CORRECTED = "CORRECTED"
    DISMISSED = "DISMISSED"


# ---------------------------------------------------------------------------
# Lifecycle state machine
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TransitionRule:
    action: str
    from_states: frozenset[str]
    to_state: str
    roles: frozenset[str]
    reason_required: bool = False
    label: str = ""


def _rule(action, from_states, to_state, roles, reason_required=False, label="") -> TransitionRule:
    return TransitionRule(
        action=action,
        from_states=frozenset(from_states),
        to_state=to_state,
        roles=frozenset(roles),
        reason_required=reason_required,
        label=label or action.replace("_", " ").title(),
    )


REVIEWERS = {Role.REVIEWING_OFFICER.value}
MAKERS = {Role.INSTITUTION_ADMIN.value}

TRANSITIONS: dict[str, TransitionRule] = {
    "SUBMIT": _rule(
        "SUBMIT",
        {LifecycleStatus.DRAFT.value, LifecycleStatus.CORRECTION_REQUIRED.value},
        LifecycleStatus.SUBMITTED.value,
        MAKERS,
        label="Submit for review",
    ),
    "START_REVIEW": _rule(
        "START_REVIEW",
        {LifecycleStatus.SUBMITTED.value},
        LifecycleStatus.UNDER_REVIEW.value,
        REVIEWERS,
        label="Start review",
    ),
    "VERIFY": _rule(
        "VERIFY",
        {LifecycleStatus.UNDER_REVIEW.value},
        LifecycleStatus.VERIFIED.value,
        REVIEWERS,
        reason_required=True,
        label="Record verification",
    ),
    "REQUEST_CORRECTION": _rule(
        "REQUEST_CORRECTION",
        {LifecycleStatus.UNDER_REVIEW.value},
        LifecycleStatus.CORRECTION_REQUIRED.value,
        REVIEWERS,
        reason_required=True,
        label="Request correction",
    ),
    "REJECT": _rule(
        "REJECT",
        {LifecycleStatus.UNDER_REVIEW.value},
        LifecycleStatus.REJECTED.value,
        REVIEWERS,
        reason_required=True,
        label="Reject submission",
    ),
    "ACTIVATE": _rule(
        "ACTIVATE",
        {LifecycleStatus.VERIFIED.value},
        LifecycleStatus.ACTIVE.value,
        REVIEWERS,
        label="Activate record",
    ),
    "MARK_MATURING": _rule(
        "MARK_MATURING",
        {LifecycleStatus.ACTIVE.value},
        LifecycleStatus.MATURING.value,
        REVIEWERS,
        label="Mark maturing",
    ),
    "MARK_REPLACED": _rule(
        "MARK_REPLACED",
        {LifecycleStatus.RENEWAL_PENDING.value},
        LifecycleStatus.REPLACED.value,
        REVIEWERS | {Role.SYSTEM_ADMIN.value},
        reason_required=True,
        label="Close as replaced",
    ),
    "MARK_EXPIRED": _rule(
        "MARK_EXPIRED",
        {
            LifecycleStatus.ACTIVE.value,
            LifecycleStatus.MATURING.value,
            LifecycleStatus.VERIFIED.value,
        },
        LifecycleStatus.EXPIRED.value,
        {Role.SYSTEM_ADMIN.value},
        reason_required=True,
        label="Mark expired",
    ),
}

# States in which an institution may still edit its submission.
EDITABLE_STATES = {
    LifecycleStatus.DRAFT.value,
    LifecycleStatus.CORRECTION_REQUIRED.value,
}

# States that still require operational attention.
OPEN_STATES = {
    LifecycleStatus.DRAFT.value,
    LifecycleStatus.SUBMITTED.value,
    LifecycleStatus.UNDER_REVIEW.value,
    LifecycleStatus.CORRECTION_REQUIRED.value,
    LifecycleStatus.VERIFIED.value,
    LifecycleStatus.ACTIVE.value,
    LifecycleStatus.MATURING.value,
    LifecycleStatus.RENEWAL_PENDING.value,
    LifecycleStatus.RELEASE_REQUESTED.value,
    LifecycleStatus.PENDING_CHECKER.value,
}

CLOSED_STATES = {
    LifecycleStatus.REJECTED.value,
    LifecycleStatus.REPLACED.value,
    LifecycleStatus.RELEASED.value,
    LifecycleStatus.EXPIRED.value,
}

TERMINAL_STATES = CLOSED_STATES

STATUS_LABELS = {
    "DRAFT": "Draft",
    "SUBMITTED": "Submitted",
    "UNDER_REVIEW": "Under review",
    "CORRECTION_REQUIRED": "Correction required",
    "REJECTED": "Rejected",
    "VERIFIED": "Verified",
    "ACTIVE": "Active",
    "MATURING": "Maturing",
    "RENEWAL_PENDING": "Renewal pending",
    "REPLACED": "Replaced",
    "RELEASE_REQUESTED": "Release requested",
    "PENDING_CHECKER": "Pending checker",
    "RELEASED": "Released",
    "EXPIRED": "Expired",
}

# Lifecycle states during which maturity monitoring applies.
MATURITY_MONITORED_STATES = {
    LifecycleStatus.VERIFIED.value,
    LifecycleStatus.ACTIVE.value,
    LifecycleStatus.MATURING.value,
    LifecycleStatus.RENEWAL_PENDING.value,
    LifecycleStatus.PENDING_CHECKER.value,
    LifecycleStatus.RELEASE_REQUESTED.value,
}

# States from which a release request (maker) may be raised.
RELEASABLE_STATES = {
    LifecycleStatus.VERIFIED.value,
    LifecycleStatus.ACTIVE.value,
    LifecycleStatus.MATURING.value,
}

# States from which a renewal/replacement may be started.
RENEWABLE_STATES = {
    LifecycleStatus.VERIFIED.value,
    LifecycleStatus.ACTIVE.value,
    LifecycleStatus.MATURING.value,
}


def transition_for(action: str) -> TransitionRule | None:
    return TRANSITIONS.get(action.upper())


def allowed_actions(status: str, role: str) -> list[str]:
    """Actions this role could take from this state (scope is checked later)."""
    return [
        rule.action
        for rule in TRANSITIONS.values()
        if status in rule.from_states and role in rule.roles
    ]


def available_transitions(status: str, role: str) -> list[dict]:
    labels = {rule.action: rule.label for rule in TRANSITIONS.values()}
    return [
        {"action": action, "label": labels.get(action, action)}
        for action in allowed_actions(status, role)
    ]


# ---------------------------------------------------------------------------
# Date policy
# ---------------------------------------------------------------------------

def business_today(timezone_name: str) -> date:
    """Current business date in the configured timezone (not UTC)."""
    try:
        tz = ZoneInfo(timezone_name)
    except Exception:  # pragma: no cover - invalid config fallback
        tz = timezone.utc
    return datetime.now(tz).date()


def days_until(maturity: date, today: date) -> int:
    return (maturity - today).days


# ---------------------------------------------------------------------------
# Explainable priority scoring
# ---------------------------------------------------------------------------

PRIORITY_RULE_VERSION = "priority-rules-v1"


@dataclass(frozen=True)
class PriorityFactor:
    code: str
    label: str
    weight: int
    detail: str = ""

    def as_dict(self) -> dict:
        return {"code": self.code, "label": self.label, "weight": self.weight, "detail": self.detail}


@dataclass(frozen=True)
class PriorityResult:
    score: int
    factors: list[PriorityFactor] = field(default_factory=list)
    rule_version: str = PRIORITY_RULE_VERSION

    @property
    def summary(self) -> str:
        if not self.factors:
            return "Priority 0: no outstanding action detected."
        reasons = "; ".join(f.detail or f.label.lower() for f in self.factors)
        return f"Priority {self.score}: {reasons}."

    def as_dict(self) -> dict:
        return {
            "score": self.score,
            "summary": self.summary,
            "rule_version": self.rule_version,
            "factors": [f.as_dict() for f in self.factors],
        }


# Weights are prototype design values, not an official risk model.
MATURITY_WEIGHTS = {"OVERDUE": 40, "WITHIN_7": 30, "WITHIN_15": 20, "WITHIN_30": 10}
WEIGHT_DISCREPANCY = 20
WEIGHT_MISSING_DOCUMENT = 15
WEIGHT_APPROVAL_OVERDUE = 20
WEIGHT_REVIEW_OVERDUE = 10
MAX_SCORE = 100


def maturity_bucket(days_remaining: int, thresholds: list[int]) -> str | None:
    """Highest applicable maturity bucket only, so weights never stack."""
    if days_remaining < 0:
        return "OVERDUE"
    ordered = sorted(thresholds)
    if 7 in ordered and days_remaining <= 7:
        return "WITHIN_7"
    if 15 in ordered and days_remaining <= 15:
        return "WITHIN_15"
    if 30 in ordered and days_remaining <= 30:
        return "WITHIN_30"
    for limit in ordered:
        if days_remaining <= limit:
            return f"WITHIN_{limit}"
    return None


def compute_priority(
    *,
    lifecycle_status: str,
    maturity_date: date,
    today: date,
    has_documents: bool,
    unresolved_discrepancies: int,
    review_overdue: bool = False,
    approval_overdue: bool = False,
    thresholds: list[int] | None = None,
) -> PriorityResult:
    thresholds = thresholds or [30, 15, 7]
    factors: list[PriorityFactor] = []
    days = days_until(maturity_date, today)

    if lifecycle_status not in TERMINAL_STATES:
        bucket = maturity_bucket(days, thresholds)
        if bucket == "OVERDUE":
            factors.append(
                PriorityFactor(
                    "MATURITY_OVERDUE",
                    "Maturity overdue",
                    MATURITY_WEIGHTS["OVERDUE"],
                    f"maturity date passed {abs(days)} day(s) ago",
                )
            )
        elif bucket == "WITHIN_7":
            factors.append(
                PriorityFactor(
                    "MATURITY_WITHIN_7",
                    "Matures within 7 days",
                    MATURITY_WEIGHTS["WITHIN_7"],
                    f"matures in {days} day(s)",
                )
            )
        elif bucket == "WITHIN_15":
            factors.append(
                PriorityFactor(
                    "MATURITY_WITHIN_15",
                    "Matures within 15 days",
                    MATURITY_WEIGHTS["WITHIN_15"],
                    f"matures in {days} day(s)",
                )
            )
        elif bucket == "WITHIN_30":
            factors.append(
                PriorityFactor(
                    "MATURITY_WITHIN_30",
                    "Matures within 30 days",
                    MATURITY_WEIGHTS["WITHIN_30"],
                    f"matures in {days} day(s)",
                )
            )

    if unresolved_discrepancies > 0:
        factors.append(
            PriorityFactor(
                "UNRESOLVED_DISCREPANCY",
                "Unresolved document discrepancy",
                WEIGHT_DISCREPANCY,
                f"{unresolved_discrepancies} document field(s) need review",
            )
        )

    if not has_documents:
        factors.append(
            PriorityFactor(
                "MISSING_DOCUMENT",
                "Supporting document missing",
                WEIGHT_MISSING_DOCUMENT,
                "no supporting document uploaded",
            )
        )

    if approval_overdue:
        factors.append(
            PriorityFactor(
                "APPROVAL_OVERDUE",
                "Release approval past SLA",
                WEIGHT_APPROVAL_OVERDUE,
                "release request has waited past the approval SLA",
            )
        )

    if review_overdue:
        factors.append(
            PriorityFactor(
                "REVIEW_OVERDUE",
                "Review past SLA",
                WEIGHT_REVIEW_OVERDUE,
                "review has been pending past the SLA",
            )
        )

    score = min(MAX_SCORE, sum(f.weight for f in factors))
    return PriorityResult(score=score, factors=factors)


def license_notice() -> str:
    return (
        "Priority weights are prototype design values, not an official AICTE or "
        "sponsor risk model."
    )
