"""Role-scoped dashboard metrics computed from stored records.

Every number returned here is counted from stored records for the caller's
scope. The shared aggregates are identical for all roles; the ``workspace``
block is shaped for the questions each role actually has to answer, so an
auditor, a checker and a system administrator do not land on the same screen.
"""

from __future__ import annotations

import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import AuthContext
from ..domain import (
    CLOSED_STATES,
    STATUS_LABELS,
    LifecycleStatus,
    Role,
    business_today,
    days_until,
    maturity_bucket,
)
from ..models import (
    AuditEvent,
    FdrDocument,
    FdrRecord,
    Institution,
    Notification,
    OcrExtraction,
    ReleaseRequest,
    User,
    UserSession,
    VerificationCheck,
    WorkflowEvent,
    utcnow,
)
from ..money import paise_to_decimal_string
from ..serializers import audit_public
from .fdr import MAX_COMPUTE_ROWS, serialize_summaries
from .insights import collect_metrics, priority_for

DASHBOARD_ROW_CAP = 5000
QUEUE_LIMIT = 6
RECENT_LIMIT = 8
REQUEST_PENDING = "PENDING_CHECKER"

RELEASE_STATUS_LABELS = {
    "PENDING_CHECKER": "Awaiting checker",
    "APPROVED": "Approved",
    "RETURNED": "Returned for clarification",
    "REJECTED": "Rejected",
}

ROLE_WORKSPACE_TITLES = {
    Role.INSTITUTION_ADMIN.value: "Your institution's deposits",
    Role.REVIEWING_OFFICER.value: "Review workspace",
    Role.APPROVING_OFFICER.value: "Checker workspace",
    Role.AUDITOR.value: "Audit workspace",
    Role.SYSTEM_ADMIN.value: "Platform operations",
}

ROLE_WORKSPACE_QUESTIONS = {
    Role.INSTITUTION_ADMIN.value: (
        "What is happening to this institution's FDRs, and what needs your action?"
    ),
    Role.REVIEWING_OFFICER.value: (
        "Which submissions need a decision, and what is blocking them?"
    ),
    Role.APPROVING_OFFICER.value: "Which release decisions can you safely make?",
    Role.AUDITOR.value: "Can you trace what happened, when, by whom and on what evidence?",
    Role.SYSTEM_ADMIN.value: "Is the platform operating safely and is access configured correctly?",
}


def _load_scoped(db: Session, auth: AuthContext) -> list[FdrRecord]:
    stmt = select(FdrRecord)
    if not auth.is_global:
        stmt = stmt.where(FdrRecord.institution_id == auth.user.institution_id)
    return list(db.execute(stmt.limit(DASHBOARD_ROW_CAP)).scalars().all())


def _document_status_counts(db: Session, fdr_ids: list[str]) -> dict[str, int]:
    if not fdr_ids:
        return {}
    rows = db.execute(
        select(FdrDocument.extraction_status, func.count(FdrDocument.id))
        .where(FdrDocument.fdr_id.in_(fdr_ids))
        .group_by(FdrDocument.extraction_status)
    ).all()
    return {status: int(count) for status, count in rows}


def _document_counts_by_fdr(db: Session, fdr_ids: list[str]) -> dict[str, int]:
    """Evidence count per record, batched so one dashboard load stays a few queries."""
    if not fdr_ids:
        return {}
    rows = db.execute(
        select(FdrDocument.fdr_id, func.count(FdrDocument.id))
        .where(FdrDocument.fdr_id.in_(fdr_ids))
        .group_by(FdrDocument.fdr_id)
    ).all()
    return {fdr_id: int(count) for fdr_id, count in rows}


def _pending_extraction_fields(db: Session, fdr_ids: list[str]) -> int:
    """Extracted candidate values nobody has confirmed or corrected yet."""
    if not fdr_ids:
        return 0
    return int(
        db.execute(
            select(func.count(OcrExtraction.id))
            .join(FdrDocument, FdrDocument.id == OcrExtraction.document_id)
            .where(
                FdrDocument.fdr_id.in_(fdr_ids),
                OcrExtraction.review_status == "PENDING",
            )
        ).scalar_one()
    )


def _audit_payload(event: AuditEvent | None) -> dict:
    if event is None:
        return {}
    try:
        payload = json.loads(event.event_payload)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _last_event(db: Session, action: str) -> AuditEvent | None:
    return db.execute(
        select(AuditEvent)
        .where(AuditEvent.action == action)
        .order_by(AuditEvent.sequence.desc())
        .limit(1)
    ).scalar_one_or_none()


def _release_queue(
    db: Session,
    institution_by_id: dict[str, str],
    document_counts: dict[str, int],
    *,
    fdr_ids: list[str],
    statuses: list[str] | None = None,
    exclude_maker_id: str | None = None,
    checker_id: str | None = None,
    limit: int = QUEUE_LIMIT,
) -> list[dict]:
    """Release requests with the facts a checker needs to judge them."""
    if not fdr_ids:
        return []
    stmt = (
        select(ReleaseRequest, FdrRecord, User)
        .join(FdrRecord, FdrRecord.id == ReleaseRequest.fdr_id)
        .join(User, User.id == ReleaseRequest.requested_by)
        .where(ReleaseRequest.fdr_id.in_(fdr_ids))
    )
    if statuses:
        stmt = stmt.where(ReleaseRequest.status.in_(statuses))
    if exclude_maker_id:
        stmt = stmt.where(ReleaseRequest.requested_by != exclude_maker_id)
    if checker_id:
        stmt = stmt.where(ReleaseRequest.checker_id == checker_id)

    rows = db.execute(stmt.order_by(ReleaseRequest.requested_at.desc()).limit(limit)).all()
    now = utcnow()
    items: list[dict] = []
    for request, fdr, maker in rows:
        age_hours = max(0, int((now - request.requested_at).total_seconds() // 3600))
        items.append(
            {
                "id": request.id,
                "fdr_id": fdr.id,
                "reference_number": fdr.reference_number,
                "institution_name": institution_by_id.get(fdr.institution_id),
                "amount": paise_to_decimal_string(fdr.amount_paise),
                "currency": fdr.currency,
                "lifecycle_status": fdr.lifecycle_status,
                "status": request.status,
                "status_label": RELEASE_STATUS_LABELS.get(request.status, request.status),
                "maker_name": maker.name,
                "maker_id": maker.id,
                "age_hours": age_hours,
                "requested_at": request.requested_at.isoformat() + "Z",
                "decided_at": request.decided_at.isoformat() + "Z" if request.decided_at else None,
                "request_reason": request.request_reason,
                "decision_reason": request.decision_reason,
                "document_count": document_counts.get(fdr.id, 0),
                "version": request.version,
            }
        )
    return items


def _count_by_status(rows: list[FdrRecord]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.lifecycle_status] = counts.get(row.lifecycle_status, 0) + 1
    return counts


def _serialize(db: Session, auth: AuthContext, subset: list, limit: int = QUEUE_LIMIT) -> list[dict]:
    return serialize_summaries(db, auth, subset[:limit])


def _reasons(priority, limit: int = 2) -> list[str]:
    """Human-readable priority factors; the score itself is never a decision."""
    return [factor.label for factor in priority.factors[:limit] if factor.label]


def _institution_admin_workspace(
    db: Session,
    auth: AuthContext,
    *,
    enriched: list,
    rows: list[FdrRecord],
    institution_by_id: dict[str, str],
    document_counts_by_fdr: dict[str, int],
    fdr_ids: list[str],
    settings: Settings,
    today,
) -> dict:
    document_counts = _document_status_counts(db, fdr_ids)
    pending_fields = _pending_extraction_fields(db, fdr_ids)
    status_counts = _count_by_status(rows)

    def open_without_documents(item) -> bool:
        fdr, metrics, _priority = item
        return not metrics.has_documents and fdr.lifecycle_status not in CLOSED_STATES

    action_items = [
        {
            "key": "CORRECTION_REQUIRED",
            "label": "Corrections requested by a reviewer",
            "count": status_counts.get(LifecycleStatus.CORRECTION_REQUIRED.value, 0),
            "detail": "Fix the flagged fields and resubmit so the record can be verified.",
            "to": "/app/fdrs?status=CORRECTION_REQUIRED",
            "tone": "warning",
        },
        {
            "key": "MISSING_EVIDENCE",
            "label": "Open records with no receipt attached",
            "count": sum(1 for item in enriched if open_without_documents(item)),
            "detail": "Without evidence a reviewer can only record an unverified decision.",
            "to": "/app/fdrs",
            "tone": "warning",
        },
        {
            "key": "UNREVIEWED_EXTRACTION",
            "label": "Extracted values you have not confirmed",
            "count": pending_fields,
            "detail": "Extraction is a candidate value, not a confirmation. Confirm or correct it.",
            "to": "/app/fdrs?discrepancy=with",
            "tone": "info",
        },
        {
            "key": "EXTRACTION_UNAVAILABLE",
            "label": "Receipts needing manual entry",
            "count": document_counts.get("UNAVAILABLE", 0)
            + document_counts.get("NO_TEXT_LAYER", 0)
            + document_counts.get("FAILED", 0),
            "detail": "No usable text could be read from these files. Enter values manually.",
            "to": "/app/fdrs",
            "tone": "neutral",
        },
        {
            "key": "DRAFT",
            "label": "Drafts not yet submitted",
            "count": status_counts.get(LifecycleStatus.DRAFT.value, 0),
            "detail": "Reviewers cannot see a draft, so it cannot be verified.",
            "to": "/app/fdrs?status=DRAFT",
            "tone": "neutral",
        },
        {
            "key": "REJECTED",
            "label": "Rejected submissions",
            "count": status_counts.get(LifecycleStatus.REJECTED.value, 0),
            "detail": "Rejected records stay in history. Raise a new record if the deposit stands.",
            "to": "/app/fdrs?status=REJECTED",
            "tone": "danger",
        },
    ]

    upcoming = sorted(
        (
            item
            for item in enriched
            if item[0].lifecycle_status not in CLOSED_STATES
            and 0 <= days_until(item[0].maturity_date, today) <= max(settings.thresholds)
        ),
        key=lambda item: item[0].maturity_date,
    )
    recent = sorted(enriched, key=lambda item: item[0].created_at, reverse=True)

    release_rows = _release_queue(
        db,
        institution_by_id,
        document_counts_by_fdr,
        fdr_ids=fdr_ids,
        limit=4,
    )

    return {
        "kind": "INSTITUTION",
        "action_items": action_items,
        "upcoming_maturities": _serialize(db, auth, upcoming, 5),
        "recent_submissions": _serialize(db, auth, recent, 5),
        "release_requests": release_rows,
        "extraction_health": {
            "documents": sum(document_counts.values()),
            "extracted": document_counts.get("EXTRACTED", 0),
            "needs_review": document_counts.get("NEEDS_REVIEW", 0),
            "unavailable": document_counts.get("UNAVAILABLE", 0)
            + document_counts.get("NO_TEXT_LAYER", 0)
            + document_counts.get("FAILED", 0),
            "pending": document_counts.get("PENDING", 0),
            "unreviewed_fields": pending_fields,
        },
        "next_step": (
            "Submit a record with its receipt attached, or clear a correction a reviewer "
            "has requested. Extracted values must be confirmed by a person before they "
            "are relied on."
        ),
    }


def _reviewer_workspace(
    db: Session,
    auth: AuthContext,
    *,
    enriched: list,
    fdr_ids: list[str],
    settings: Settings,
    today,
) -> dict:
    def status_of(item) -> str:
        return item[0].lifecycle_status

    inbox = [
        item
        for item in enriched
        if status_of(item) in {LifecycleStatus.SUBMITTED.value, LifecycleStatus.UNDER_REVIEW.value}
    ]
    inbox.sort(key=lambda item: (-item[2].score, item[0].maturity_date))

    # A record is a resubmission when it was returned for correction and is back in review.
    corrected_ids = set(
        db.execute(
            select(WorkflowEvent.fdr_id).where(
                WorkflowEvent.fdr_id.in_(fdr_ids),
                WorkflowEvent.action == "REQUEST_CORRECTION",
            )
        ).scalars()
    )
    resubmitted = [
        item
        for item in inbox
        if item[0].id in corrected_ids
        and status_of(item) == LifecycleStatus.SUBMITTED.value
    ]

    discrepancy_worklist = [item for item in enriched if item[1].unresolved_discrepancies > 0]
    discrepancy_worklist.sort(key=lambda item: -item[1].unresolved_discrepancies)

    missing_evidence = [
        item
        for item in inbox
        if not item[1].has_documents
    ]

    maturity_risk = [
        item
        for item in enriched
        if status_of(item) not in CLOSED_STATES
        and (
            days_until(item[0].maturity_date, today) < 0
            or days_until(item[0].maturity_date, today) <= min(settings.thresholds)
        )
    ]
    maturity_risk.sort(key=lambda item: item[0].maturity_date)

    overdue_reviews = [item for item in inbox if item[1].review_overdue]

    return {
        "kind": "REVIEWER",
        "review_inbox": _serialize(db, auth, inbox),
        "inbox_reasons": {row.id: _reasons(priority) for row, _m, priority in inbox},
        "counts": {
            "awaiting_decision": len(inbox),
            "resubmitted_after_correction": len(resubmitted),
            "missing_evidence": len(missing_evidence),
            "unresolved_discrepancies": len(discrepancy_worklist),
            "overdue_beyond_sla": len(overdue_reviews),
            "urgent_maturity": len(maturity_risk),
        },
        "discrepancy_worklist": _serialize(db, auth, discrepancy_worklist),
        "correction_resubmissions": _serialize(db, auth, resubmitted),
        "maturity_risk": _serialize(db, auth, maturity_risk, 5),
        "review_sla_hours": settings.review_sla_hours,
        "next_step": (
            "Open a submission, compare the entered values with the extracted evidence, "
            "then record a decision with a reason. A provider result is never treated as "
            "bank confirmation."
        ),
    }


def _checker_workspace(
    db: Session,
    auth: AuthContext,
    *,
    fdr_ids: list[str],
    institution_by_id: dict[str, str],
    document_counts_by_fdr: dict[str, int],
    settings: Settings,
) -> dict:
    awaiting = _release_queue(
        db,
        institution_by_id,
        document_counts_by_fdr,
        fdr_ids=fdr_ids,
        statuses=[REQUEST_PENDING],
        exclude_maker_id=auth.user.id,
    )
    all_pending = _release_queue(
        db,
        institution_by_id,
        document_counts_by_fdr,
        fdr_ids=fdr_ids,
        statuses=[REQUEST_PENDING],
        limit=50,
    )
    # Must always be empty: makers are institution administrators and a checker
    # cannot raise a request. The server also rejects self-decisions outright.
    own_raised = [item for item in all_pending if item["maker_id"] == auth.user.id]
    decided = _release_queue(
        db,
        institution_by_id,
        document_counts_by_fdr,
        fdr_ids=fdr_ids,
        statuses=["APPROVED", "RETURNED", "REJECTED"],
        checker_id=auth.user.id,
        limit=5,
    )
    approval_overdue = [
        item for item in (awaiting + own_raised) if item["age_hours"] >= settings.approval_sla_hours
    ]

    return {
        "kind": "CHECKER",
        "awaiting_decision": awaiting,
        "own_raised_requests": own_raised,
        "decided_by_you": decided,
        "counts": {
            "awaiting_your_decision": len(awaiting),
            "raised_by_you_blocked": len(own_raised),
            "decided_by_you": len(decided),
            "beyond_sla": len(approval_overdue),
        },
        "approval_sla_hours": settings.approval_sla_hours,
        "eligibility": {
            "requires_manual_verification": True,
            "requires_evidence": True,
            "self_approval_blocked": True,
            "note": (
                "A release request must be manually verified and raised by an institution "
                "administrator. You cannot decide a request you raised yourself — the server "
                "rejects it even if the button is reached another way."
            ),
        },
        "next_step": (
            "Inspect the evidence and history of a request, then approve, return or reject "
            "with a reason. This prototype records a decision only; it does not move funds "
            "or contact a bank."
        ),
    }


def _auditor_workspace(
    db: Session,
    auth: AuthContext,
    *,
    rows: list[FdrRecord],
    enriched: list,
    fdr_ids: list[str],
    institution_by_id: dict[str, str],
) -> dict:
    transitions = (
        db.execute(
            select(WorkflowEvent, FdrRecord)
            .join(FdrRecord, FdrRecord.id == WorkflowEvent.fdr_id)
            .where(WorkflowEvent.fdr_id.in_(fdr_ids))
            .order_by(WorkflowEvent.created_at.desc())
            .limit(RECENT_LIMIT)
        ).all()
        if fdr_ids
        else []
    )

    verification_counts = (
        db.execute(
            select(VerificationCheck.simulated, func.count(VerificationCheck.id))
            .where(VerificationCheck.fdr_id.in_(fdr_ids))
            .group_by(VerificationCheck.simulated)
        ).all()
        if fdr_ids
        else []
    )
    manual_confirmed = sum(1 for row in rows if row.verification_status == "MANUAL_CONFIRMED")
    simulated_only = sum(
        1
        for row in rows
        if row.verification_status not in {"MANUAL_CONFIRMED", "UNVERIFIED"}
    )

    chain_event = _last_event(db, "AUDIT_CHAIN_VERIFIED")
    chain_payload = _audit_payload(chain_event)

    return {
        "kind": "AUDITOR",
        "coverage": {
            "records_in_scope": len(rows),
            "institutions_in_scope": len({row.institution_id for row in rows}),
            "closed_records": sum(1 for row in rows if row.lifecycle_status in CLOSED_STATES),
            "unresolved_discrepancies": sum(
                1 for item in enriched if item[1].unresolved_discrepancies > 0
            ),
        },
        "checks": {
            "simulated_checks": sum(
                count for simulated, count in verification_counts if simulated
            ),
            "manual_checks": sum(
                count for simulated, count in verification_counts if not simulated
            ),
            "manually_confirmed_records": manual_confirmed,
            "provider_only_records": simulated_only,
        },
        "recent_transitions": [
            {
                "id": event.id,
                "fdr_id": fdr.id,
                "reference_number": fdr.reference_number,
                "institution_name": institution_by_id.get(fdr.institution_id),
                "action": event.action,
                "action_label": event.action.replace("_", " ").title(),
                "from_state": event.from_state,
                "from_label": STATUS_LABELS.get(event.from_state or "", event.from_state),
                "to_state": event.to_state,
                "to_label": STATUS_LABELS.get(event.to_state or "", event.to_state),
                "actor_label": event.actor_label,
                "reason": event.reason,
                "created_at": event.created_at.isoformat() + "Z",
            }
            for event, fdr in transitions
        ],
        "chain_check": {
            "last_checked_at": chain_event.occurred_at.isoformat() + "Z" if chain_event else None,
            "checked_by": chain_event.actor_label if chain_event else None,
            "valid": chain_payload.get("valid"),
            "checked": chain_payload.get("checked"),
            "broken_sequence": chain_payload.get("broken_sequence"),
        },
        "read_only": True,
        "next_step": (
            "Open a record's workflow and audit tabs to reconstruct who did what and when. "
            "Audit access is read-only; the integrity check is tamper-evident, not proof "
            "that an FDR is genuine."
        ),
        "limitation": (
            "Hash chaining detects edits to recorded history. It cannot guarantee immutability "
            "if a privileged actor can rewrite every event and the chain head."
        ),
    }


def _system_admin_workspace(
    db: Session,
    auth: AuthContext,
    *,
    settings: Settings,
    rows: list[FdrRecord],
    fdr_ids: list[str],
    institution_by_id: dict[str, str],
    document_counts_by_fdr: dict[str, int],
) -> dict:
    role_counts = db.execute(
        select(User.role, func.count(User.id)).group_by(User.role)
    ).all()
    total_users = int(db.execute(select(func.count(User.id))).scalar_one())
    active_users = int(
        db.execute(select(func.count(User.id)).where(User.is_active.is_(True))).scalar_one()
    )
    active_sessions = int(
        db.execute(
            select(func.count(UserSession.id)).where(UserSession.revoked_at.is_(None))
        ).scalar_one()
    )
    locked_accounts = int(
        db.execute(select(func.count(User.id)).where(User.locked_until.is_not(None))).scalar_one()
    )
    credentials_with_failures = int(
        db.execute(
            select(func.count(User.id)).where(User.failed_login_count > 0)
        ).scalar_one()
    )
    notification_counts = {
        status: int(count)
        for status, count in db.execute(
            select(Notification.status, func.count(Notification.id)).group_by(Notification.status)
        ).all()
    }
    document_counts = _document_status_counts(db, fdr_ids)

    admin_events = (
        db.execute(
            select(AuditEvent)
            .where(
                AuditEvent.action.in_(
                    [
                        "USER_UPDATED",
                        "INSTITUTION_CREATED",
                        "INSTITUTION_UPDATED",
                        "AUDIT_CHAIN_VERIFIED",
                        "MATURITY_SCAN_RUN",
                    ]
                )
            )
            .order_by(AuditEvent.sequence.desc())
            .limit(RECENT_LIMIT)
        )
        .scalars()
        .all()
    )

    last_scan = _last_event(db, "MATURITY_SCAN_RUN")
    chain_event = _last_event(db, "AUDIT_CHAIN_VERIFIED")

    pending_release = _release_queue(
        db,
        institution_by_id,
        document_counts_by_fdr,
        fdr_ids=fdr_ids,
        statuses=[REQUEST_PENDING],
        limit=5,
    )

    return {
        "kind": "SYSTEM_ADMIN",
        "accounts": {
            "total": total_users,
            "active": active_users,
            "inactive": total_users - active_users,
            "by_role": [
                {"role": role, "count": int(count)}
                for role, count in sorted(role_counts, key=lambda item: -int(item[1]))
            ],
            "active_sessions": active_sessions,
            "locked_or_throttled": locked_accounts,
            "accounts_with_failed_attempts": credentials_with_failures,
        },
        "scheduler": {
            "enabled": settings.scheduler_enabled,
            "hour_utc": settings.maturity_scan_hour_utc,
            "thresholds": settings.thresholds,
            "timezone": settings.business_timezone,
            "last_run_at": last_scan.occurred_at.isoformat() + "Z" if last_scan else None,
            "last_run": _audit_payload(last_scan),
            "single_instance_only": True,
        },
        "delivery": {
            "in_app": notification_counts.get("DELIVERED", 0),
            "failed": notification_counts.get("FAILED", 0),
            "pending": notification_counts.get("PENDING", 0),
            "email_configured": False,
        },
        "extraction": {
            "documents": sum(document_counts.values()),
            "unavailable": document_counts.get("UNAVAILABLE", 0)
            + document_counts.get("NO_TEXT_LAYER", 0)
            + document_counts.get("FAILED", 0),
            "pending": document_counts.get("PENDING", 0),
            "image_ocr_available": False,
        },
        "integrations": [
            {
                "key": "BANK_VERIFICATION",
                "label": (
                    "Simulated adapter — demo only"
                    if settings.bank_verification_mode == "simulated"
                    else "Manual verification (no bank provider)"
                ),
                "state": "SIMULATED" if settings.bank_verification_mode == "simulated" else "MANUAL",
                "production_ready": False,
            },
            {
                "key": "EMAIL_DELIVERY",
                "label": "Not configured — in-app alerts only",
                "state": "NOT_CONFIGURED",
                "production_ready": False,
            },
            {
                "key": "MALWARE_SCANNING",
                "label": "Not configured",
                "state": "NOT_CONFIGURED",
                "production_ready": False,
            },
            {
                "key": "AUDIT_INTEGRITY",
                "label": "Hash-chained audit trail",
                "state": "ACTIVE",
                "production_ready": True,
            },
        ],
        "chain_check": {
            "last_checked_at": chain_event.occurred_at.isoformat() + "Z" if chain_event else None,
        },
        "release_queue": pending_release,
        "records_in_scope": len(rows),
        "recent_admin_events": [
            audit_public(event, institution_by_id.get(event.entity_id)) for event in admin_events
        ],
        "next_step": (
            "Review access, run the maturity scan or verify the audit chain. Administrative "
            "changes are audited and never silently alter a financial decision."
        ),
    }


def _workspace(
    db: Session,
    auth: AuthContext,
    settings: Settings,
    *,
    rows: list[FdrRecord],
    enriched: list,
    today,
    institution_by_id: dict[str, str],
) -> dict:
    role = auth.user.role
    fdr_ids = [row.id for row in rows]
    document_counts_by_fdr = _document_counts_by_fdr(db, fdr_ids)

    if role == Role.REVIEWING_OFFICER.value:
        block = _reviewer_workspace(
            db,
            auth,
            enriched=enriched,
            fdr_ids=fdr_ids,
            settings=settings,
            today=today,
        )
    elif role == Role.APPROVING_OFFICER.value:
        block = _checker_workspace(
            db,
            auth,
            fdr_ids=fdr_ids,
            institution_by_id=institution_by_id,
            document_counts_by_fdr=document_counts_by_fdr,
            settings=settings,
        )
    elif role == Role.AUDITOR.value:
        block = _auditor_workspace(
            db,
            auth,
            rows=rows,
            enriched=enriched,
            fdr_ids=fdr_ids,
            institution_by_id=institution_by_id,
        )
    elif role == Role.SYSTEM_ADMIN.value:
        block = _system_admin_workspace(
            db,
            auth,
            settings=settings,
            rows=rows,
            fdr_ids=fdr_ids,
            institution_by_id=institution_by_id,
            document_counts_by_fdr=document_counts_by_fdr,
        )
    else:
        block = _institution_admin_workspace(
            db,
            auth,
            enriched=enriched,
            rows=rows,
            institution_by_id=institution_by_id,
            document_counts_by_fdr=document_counts_by_fdr,
            fdr_ids=fdr_ids,
            settings=settings,
            today=today,
        )

    block["role"] = role
    block["title"] = ROLE_WORKSPACE_TITLES.get(role, "Workspace")
    block["question"] = ROLE_WORKSPACE_QUESTIONS.get(role)
    block["generated_at"] = utcnow().isoformat() + "Z"
    return block


def summary(db: Session, auth: AuthContext, settings: Settings) -> dict:
    rows = _load_scoped(db, auth)
    metrics = collect_metrics(db, rows, settings=settings)
    today = business_today(settings.business_timezone)
    thresholds = settings.thresholds
    max_threshold = max(thresholds)

    enriched = [
        (row, metrics[row.id], priority_for(row, metrics[row.id], settings=settings, today=today))
        for row in rows
    ]

    def count(predicate) -> int:
        return sum(1 for row, metric, _ in enriched if predicate(row, metric))

    metrics_payload = {
        "total_fdrs": len(rows),
        "active": count(lambda f, _m: f.lifecycle_status in {"ACTIVE", "MATURING"}),
        "pending_review": count(
            lambda f, _m: f.lifecycle_status in {"SUBMITTED", "UNDER_REVIEW"}
        ),
        "correction_required": count(
            lambda f, _m: f.lifecycle_status == "CORRECTION_REQUIRED"
        ),
        "upcoming_maturity": count(
            lambda f, _m: f.lifecycle_status not in CLOSED_STATES
            and 0 <= days_until(f.maturity_date, today) <= max_threshold
        ),
        "overdue": count(
            lambda f, _m: f.lifecycle_status not in CLOSED_STATES
            and days_until(f.maturity_date, today) < 0
        ),
        "discrepancies": count(lambda _f, m: m.unresolved_discrepancies > 0),
        "missing_evidence": count(
            lambda f, m: not m.has_documents and f.lifecycle_status not in CLOSED_STATES
        ),
        "pending_release_approvals": 0,
        "released": count(lambda f, _m: f.lifecycle_status == "RELEASED"),
        "verified": count(lambda f, _m: f.lifecycle_status == "VERIFIED"),
    }

    release_stmt = select(ReleaseRequest).join(FdrRecord, FdrRecord.id == ReleaseRequest.fdr_id).where(
        ReleaseRequest.status == "PENDING_CHECKER"
    )
    if not auth.is_global:
        release_stmt = release_stmt.where(FdrRecord.institution_id == auth.user.institution_id)
    pending_releases = db.execute(release_stmt).scalars().all()
    metrics_payload["pending_release_approvals"] = len(pending_releases)
    if auth.user.role == "APPROVING_OFFICER":
        metrics_payload["pending_release_approvals"] = sum(
            1 for request in pending_releases if request.requested_by != auth.user.id
        )
    metrics_payload["own_pending_release_requests"] = sum(
        1 for request in pending_releases if request.requested_by == auth.user.id
    )

    enriched.sort(key=lambda item: (-item[2].score, item[0].maturity_date))
    attention = serialize_summaries(db, auth, enriched[:6])

    buckets = []
    for key, label in (
        ("OVERDUE", "Overdue"),
        ("WITHIN_7", "Within 7 days"),
        ("WITHIN_15", "Within 15 days"),
        ("WITHIN_30", "Within 30 days"),
    ):
        buckets.append(
            {
                "key": key,
                "label": label,
                "count": count(
                    lambda f, _m, key=key: f.lifecycle_status not in CLOSED_STATES
                    and maturity_bucket(days_until(f.maturity_date, today), thresholds) == key
                ),
            }
        )

    fdr_ids = [row.id for row in rows]
    recent = []
    if fdr_ids:
        recent = (
            db.execute(
                select(AuditEvent)
                .where(AuditEvent.entity_type == "FDR", AuditEvent.entity_id.in_(fdr_ids))
                .order_by(AuditEvent.sequence.desc())
                .limit(8)
            )
            .scalars()
            .all()
        )
    reference_by_id = {row.id: row.reference_number for row in rows}

    institution_by_id: dict[str, str] = {}
    institution_ids = {row.institution_id for row in rows}
    if auth.user.institution_id:
        institution_ids.add(auth.user.institution_id)
    if institution_ids:
        institution_by_id = {
            institution.id: institution.name
            for institution in db.execute(
                select(Institution).where(Institution.id.in_(institution_ids))
            ).scalars()
        }

    scope = {
        "role": auth.user.role,
        "is_global": auth.is_global,
        "label": "All institutions" if auth.is_global else None,
        "institution": None,
    }
    if auth.user.institution_id:
        institution = db.get(Institution, auth.user.institution_id)
        if institution:
            scope["institution"] = {
                "id": institution.id,
                "name": institution.name,
                "institution_code": institution.institution_code,
            }
            scope["label"] = institution.name

    return {
        "metrics": metrics_payload,
        "needs_attention": attention,
        "maturity_buckets": buckets,
        "recent_activity": [
            audit_public(event, reference_by_id.get(event.entity_id)) for event in recent
        ],
        "scope": scope,
        "workspace": _workspace(
            db,
            auth,
            settings,
            rows=rows,
            enriched=enriched,
            today=today,
            institution_by_id=institution_by_id,
        ),
        "generated_at": utcnow().isoformat() + "Z",
        "business_date": today.isoformat(),
        "row_cap": MAX_COMPUTE_ROWS,
        "truncated": len(rows) >= DASHBOARD_ROW_CAP,
    }
