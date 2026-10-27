"""Release requests with maker-checker separation.

A release decision in this prototype records an authorization outcome. It does
not move funds and does not contact a bank.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import record_audit
from ..deps import AuthContext, assert_fdr_read
from ..domain import (
    RELEASABLE_STATES,
    LifecycleStatus,
    ReleaseStatus,
    Role,
    VerificationStatus,
)
from ..errors import conflict, forbidden, not_found, validation_error
from ..models import FdrRecord, ReleaseRequest, WorkflowEvent, new_id, utcnow
from ..schemas import ReleaseDecisionRequest, ReleaseRequestCreate


@dataclass
class ReleaseListParams:
    status: str | None = None
    search: str | None = None
    page: int = 1
    page_size: int = 20


def create_release_request(
    db: Session, auth: AuthContext, payload: ReleaseRequestCreate
) -> ReleaseRequest:
    if auth.user.role != Role.INSTITUTION_ADMIN.value:
        raise forbidden("Only the owning institution can raise a release request.")
    fdr = db.get(FdrRecord, payload.fdr_id)
    if fdr is None:
        raise not_found("FDR record")
    if fdr.institution_id != auth.user.institution_id:
        raise not_found("FDR record")

    existing = db.execute(
        select(ReleaseRequest).where(
            ReleaseRequest.fdr_id == fdr.id,
            ReleaseRequest.status == ReleaseStatus.PENDING_CHECKER.value,
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise conflict(
            "This record already has a release request awaiting a checker decision.",
            code="DUPLICATE_RELEASE_REQUEST",
        )

    if fdr.lifecycle_status not in (RELEASABLE_STATES | {LifecycleStatus.RELEASE_REQUESTED.value}):
        raise conflict(
            "A release request can only be raised for a verified or active record.",
            code="INVALID_TRANSITION",
        )
    if payload.expected_version is not None and payload.expected_version != fdr.version:
        raise conflict(
            "This record changed since you loaded it. Reload and try again.",
            code="STALE_RECORD",
        )
    if fdr.verification_status != VerificationStatus.MANUAL_CONFIRMED.value:
        raise conflict(
            "Record a manual verification before requesting a release. "
            "A simulated provider result is not a verification.",
            code="VERIFICATION_REQUIRED",
        )

    previous_state = fdr.lifecycle_status
    request = ReleaseRequest(
        id=new_id(),
        fdr_id=fdr.id,
        requested_by=auth.user.id,
        request_reason=payload.request_reason,
        status=ReleaseStatus.PENDING_CHECKER.value,
        previous_lifecycle_state=previous_state,
    )
    db.add(request)
    fdr.lifecycle_status = LifecycleStatus.PENDING_CHECKER.value
    fdr.version += 1
    db.flush()

    db.add(
        WorkflowEvent(
            fdr_id=fdr.id,
            actor_id=auth.user.id,
            actor_label=auth.user.email,
            from_state=previous_state,
            to_state=fdr.lifecycle_status,
            action="RELEASE_REQUESTED",
            reason=payload.request_reason,
        )
    )
    record_audit(
        db,
        actor=auth.user,
        entity_type="FDR",
        entity_id=fdr.id,
        action="RELEASE_REQUESTED",
        payload={
            "release_request_id": request.id,
            "reason": payload.request_reason,
            "from_state": previous_state,
            "to_state": fdr.lifecycle_status,
        },
    )
    db.commit()
    db.refresh(request)
    return request


def _load_request(db: Session, auth: AuthContext, request_id: str) -> tuple[ReleaseRequest, FdrRecord]:
    request = db.get(ReleaseRequest, request_id)
    if request is None:
        raise not_found("Release request")
    fdr = db.get(FdrRecord, request.fdr_id)
    if fdr is None:
        raise not_found("Release request")
    assert_fdr_read(auth, fdr)
    return request, fdr


def decide_release_request(
    db: Session, auth: AuthContext, request_id: str, payload: ReleaseDecisionRequest
) -> ReleaseRequest:
    if auth.user.role != Role.APPROVING_OFFICER.value:
        raise forbidden("Only an approving officer can decide a release request.")
    request, fdr = _load_request(db, auth, request_id)

    if request.status != ReleaseStatus.PENDING_CHECKER.value:
        raise conflict(
            "This release request has already been decided.",
            code="ALREADY_DECIDED",
        )
    if request.requested_by == auth.user.id:
        raise forbidden(
            "Maker-checker separation: you cannot decide a release request you raised."
        )
    if payload.expected_version is not None and payload.expected_version != request.version:
        raise conflict(
            "This release request changed since you loaded it. Reload and try again.",
            code="STALE_RECORD",
        )
    if fdr.lifecycle_status != LifecycleStatus.PENDING_CHECKER.value:
        raise conflict(
            "The FDR is no longer awaiting a checker decision.",
            code="INVALID_TRANSITION",
        )

    now = utcnow()
    request.checker_id = auth.user.id
    request.decision_reason = payload.reason
    request.decided_at = now
    request.version += 1
    from_state = fdr.lifecycle_status

    if payload.decision == "APPROVE":
        request.status = ReleaseStatus.APPROVED.value
        fdr.lifecycle_status = LifecycleStatus.RELEASED.value
        fdr.released_at = now
        fdr.released_by = auth.user.id
    elif payload.decision == "RETURN":
        request.status = ReleaseStatus.RETURNED.value
        fdr.lifecycle_status = LifecycleStatus.RELEASE_REQUESTED.value
    else:
        request.status = ReleaseStatus.REJECTED.value
        fdr.lifecycle_status = request.previous_lifecycle_state

    fdr.version += 1
    db.add(
        WorkflowEvent(
            fdr_id=fdr.id,
            actor_id=auth.user.id,
            actor_label=auth.user.email,
            from_state=from_state,
            to_state=fdr.lifecycle_status,
            action=f"RELEASE_{payload.decision}",
            reason=payload.reason,
        )
    )
    record_audit(
        db,
        actor=auth.user,
        entity_type="FDR",
        entity_id=fdr.id,
        action="RELEASE_DECISION",
        payload={
            "release_request_id": request.id,
            "decision": payload.decision,
            "reason": payload.reason,
            "maker_id": request.requested_by,
            "checker_id": auth.user.id,
            "from_state": from_state,
            "to_state": fdr.lifecycle_status,
        },
    )
    db.commit()
    db.refresh(request)
    return request


def list_release_requests(db: Session, auth: AuthContext, params: ReleaseListParams) -> tuple[list[ReleaseRequest], int]:
    stmt = select(ReleaseRequest).join(FdrRecord, FdrRecord.id == ReleaseRequest.fdr_id)
    if not auth.is_global:
        stmt = stmt.where(FdrRecord.institution_id == auth.user.institution_id)
    if params.status:
        stmt = stmt.where(ReleaseRequest.status == params.status)
    if params.search:
        like = f"%{params.search.strip().lower()}%"
        stmt = stmt.where(func.lower(FdrRecord.reference_number).like(like))
    total = db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar_one()
    rows = (
        db.execute(
            stmt.order_by(ReleaseRequest.requested_at.desc())
            .offset((params.page - 1) * params.page_size)
            .limit(params.page_size)
        )
        .scalars()
        .all()
    )
    return list(rows), total


def get_pending_for_checker(db: Session, auth: AuthContext, request_id: str) -> tuple[ReleaseRequest, FdrRecord]:
    return _load_request(db, auth, request_id)
