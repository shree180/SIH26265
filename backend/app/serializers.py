"""Response serializers.

Only permitted fields are exposed. Storage keys, password hashes and provider
internals are never serialized.
"""

from __future__ import annotations

from datetime import date, datetime

from .domain import (
    STATUS_LABELS,
    PriorityResult,
    available_transitions,
    days_until,
)
from .models import (
    AuditEvent,
    FdrDocument,
    FdrRecord,
    Institution,
    Notification,
    OcrExtraction,
    ReleaseRequest,
    User,
    VerificationCheck,
    WorkflowEvent,
)
from .money import paise_to_decimal_string
from .services.extraction import FIELD_KINDS
from .services.insights import FdrMetrics


def iso(value: datetime | None) -> str | None:
    return value.isoformat() + "Z" if value else None


def iso_date(value: date | None) -> str | None:
    return value.isoformat() if value else None


def user_public(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
        "institution": (
            {
                "id": user.institution.id,
                "name": user.institution.name,
                "institution_code": user.institution.institution_code,
            }
            if user.institution
            else None
        ),
        "last_login_at": iso(user.last_login_at),
    }


def institution_public(institution: Institution) -> dict:
    return {
        "id": institution.id,
        "institution_code": institution.institution_code,
        "name": institution.name,
        "contact_email": institution.contact_email,
        "status": institution.status,
        "created_at": iso(institution.created_at),
    }


def document_public(document: FdrDocument) -> dict:
    return {
        "id": document.id,
        "original_filename": document.original_filename,
        "content_type": document.content_type,
        "size_bytes": document.size_bytes,
        "document_type": document.document_type,
        "sha256_digest": document.sha256_digest,
        "uploaded_at": iso(document.uploaded_at),
        "scan_status": document.scan_status,
        "extraction_status": document.extraction_status,
        "extraction_engine": document.extraction_engine,
        "extraction_note": document.extraction_note,
        "extracted_at": iso(document.extracted_at),
        "download_url": f"/api/v1/documents/{document.id}",
        "extractions": [extraction_public(item) for item in document.extractions],
    }


def extraction_public(extraction: OcrExtraction) -> dict:
    return {
        "id": extraction.id,
        "field_name": extraction.field_name,
        "kind": FIELD_KINDS.get(extraction.field_name, "text"),
        "extracted_value": extraction.extracted_value,
        "confidence": extraction.confidence,
        "page_number": extraction.page_number,
        "review_status": extraction.review_status,
        "reviewed_at": iso(extraction.reviewed_at),
        "corrected_value": extraction.corrected_value,
    }


def verification_public(check: VerificationCheck, actor_name: str | None = None) -> dict:
    return {
        "id": check.id,
        "method": check.method,
        "provider": check.provider,
        "result": check.result,
        "checked_at": iso(check.checked_at),
        "checked_by": actor_name,
        "evidence_reference": check.evidence_reference,
        "notes": check.notes,
        "simulated": check.simulated,
    }


def workflow_public(event: WorkflowEvent) -> dict:
    return {
        "id": event.id,
        "action": event.action,
        "from_state": event.from_state,
        "to_state": event.to_state,
        "reason": event.reason,
        "actor_label": event.actor_label,
        "created_at": iso(event.created_at),
    }


def release_public(
    request: ReleaseRequest,
    *,
    requester: User | None = None,
    checker: User | None = None,
    fdr: FdrRecord | None = None,
    institution: Institution | None = None,
    approval_sla_hours: int = 48,
) -> dict:
    from datetime import timedelta

    from .models import utcnow

    overdue = bool(
        request.status == "PENDING_CHECKER"
        and request.requested_at < (utcnow() - timedelta(hours=approval_sla_hours))
    )
    return {
        "id": request.id,
        "fdr_id": request.fdr_id,
        "fdr_reference": fdr.reference_number if fdr else None,
        "institution_name": institution.name if institution else None,
        "requested_by": (
            {"id": requester.id, "name": requester.name, "email": requester.email}
            if requester
            else None
        ),
        "request_reason": request.request_reason,
        "status": request.status,
        "checker": (
            {"id": checker.id, "name": checker.name, "email": checker.email}
            if checker
            else None
        ),
        "decision_reason": request.decision_reason,
        "previous_lifecycle_state": request.previous_lifecycle_state,
        "requested_at": iso(request.requested_at),
        "decided_at": iso(request.decided_at),
        "version": request.version,
        "approval_overdue": overdue,
    }


def notification_public(notification: Notification, fdr: FdrRecord | None = None) -> dict:
    threshold = notification.threshold_days
    if notification.alert_type == "MATURITY_OVERDUE":
        message = "Maturity date has passed. Confirm the next action with the responsible officer."
    elif threshold is not None:
        message = (
            f"Maturity in {threshold} day(s) or fewer. Confirm the next action with the "
            "responsible officer."
        )
    else:
        message = "Action required."
    return {
        "id": notification.id,
        "fdr_id": notification.fdr_id,
        "fdr_reference": fdr.reference_number if fdr else None,
        "alert_type": notification.alert_type,
        "threshold_days": threshold,
        "message": message,
        "channel": notification.channel,
        "status": notification.status,
        "created_at": iso(notification.created_at),
        "sent_at": iso(notification.sent_at),
        "acknowledged_at": iso(notification.acknowledged_at),
        "delivery_reference": notification.delivery_reference,
        "error_summary": notification.error_summary,
    }


def audit_public(event: AuditEvent, entity_label: str | None = None) -> dict:
    import json

    try:
        payload = json.loads(event.event_payload)
    except json.JSONDecodeError:
        payload = {"raw": event.event_payload}
    return {
        "id": event.id,
        "sequence": event.sequence,
        "actor_label": event.actor_label,
        "entity_type": event.entity_type,
        "entity_id": event.entity_id,
        "entity_label": entity_label,
        "action": event.action,
        "payload": payload,
        "occurred_at": iso(event.occurred_at),
        "previous_hash": event.previous_hash,
        "event_hash": event.event_hash,
    }


def fdr_summary(
    fdr: FdrRecord,
    *,
    institution: Institution | None,
    metrics: FdrMetrics,
    priority: PriorityResult,
    today: date,
) -> dict:
    return {
        "id": fdr.id,
        "reference_number": fdr.reference_number,
        "institution": (
            {
                "id": institution.id,
                "name": institution.name,
                "institution_code": institution.institution_code,
            }
            if institution
            else None
        ),
        "bank_name": fdr.bank_name,
        "bank_code": fdr.bank_code,
        "amount": paise_to_decimal_string(fdr.amount_paise),
        "currency": fdr.currency,
        "issue_date": iso_date(fdr.issue_date),
        "maturity_date": iso_date(fdr.maturity_date),
        "days_remaining": days_until(fdr.maturity_date, today),
        "lifecycle_status": fdr.lifecycle_status,
        "status_label": STATUS_LABELS.get(fdr.lifecycle_status, fdr.lifecycle_status),
        "verification_status": fdr.verification_status,
        "priority": priority.as_dict(),
        "has_documents": metrics.has_documents,
        "document_count": metrics.document_count,
        "discrepancy_count": metrics.discrepancy_count,
        "unresolved_discrepancies": metrics.unresolved_discrepancies,
        "pending_release_id": (
            metrics.pending_release.id if metrics.pending_release else None
        ),
        "created_at": iso(fdr.created_at),
        "updated_at": iso(fdr.updated_at),
        "version": fdr.version,
    }


def fdr_detail(
    fdr: FdrRecord,
    *,
    institution: Institution | None,
    metrics: FdrMetrics,
    priority: PriorityResult,
    today: date,
    documents: list[FdrDocument],
    workflow_events: list[WorkflowEvent],
    verification_checks: list[VerificationCheck],
    release_requests: list[dict],
    audit_events: list[dict],
    renewal: dict,
    permissions: dict,
    user_names: dict[str, str],
    notes: str | None,
    created_by: User | None,
) -> dict:
    payload = fdr_summary(
        fdr, institution=institution, metrics=metrics, priority=priority, today=today
    )
    payload.update(
        {
            "notes": notes,
            "created_by": (
                {"id": created_by.id, "name": created_by.name} if created_by else None
            ),
            "submitted_at": iso(fdr.submitted_at),
            "verified_at": iso(fdr.verified_at),
            "activated_at": iso(fdr.activated_at),
            "released_at": iso(fdr.released_at),
            "released_by": user_names.get(fdr.released_by or ""),
            "documents": [document_public(document) for document in documents],
            "discrepancies": metrics.discrepancies,
            "workflow_events": [workflow_public(event) for event in workflow_events],
            "verification_checks": [
                verification_public(check, user_names.get(check.checked_by or ""))
                for check in verification_checks
            ],
            "release_requests": release_requests,
            "audit_events": audit_events,
            "renewal": renewal,
            "available_transitions": available_transitions(fdr.lifecycle_status, permissions["role"]),
            "permissions": permissions,
        }
    )
    return payload
