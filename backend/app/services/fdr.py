"""FDR record lifecycle, submission, review, renewal and read models."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..audit import record_audit
from ..deps import AuthContext, assert_fdr_read, assert_institution_owner
from ..domain import (
    EDITABLE_STATES,
    GLOBAL_ROLES,
    MATURITY_MONITORED_STATES,
    OPEN_STATES,
    RENEWABLE_STATES,
    RELEASABLE_STATES,
    TERMINAL_STATES,
    LifecycleStatus,
    Role,
    VerificationStatus,
    available_transitions,
    business_today,
    compute_priority,
    days_until,
    transition_for,
)
from ..errors import ApiError, conflict, forbidden, not_found, validation_error
from ..models import (
    AuditEvent,
    FdrDocument,
    FdrRecord,
    Institution,
    ReleaseRequest,
    RenewalLink,
    User,
    VerificationCheck,
    WorkflowEvent,
    new_id,
    utcnow,
)
from ..money import paise_to_decimal_string, validate_amount
from ..schemas import FdrCreate, RenewalRequest, TransitionRequest
from ..serializers import audit_public, fdr_detail, fdr_summary, release_public
from .insights import FdrMetrics, collect_metrics, priority_for

SYSTEM_ACTIONS = {"MARK_MATURING", "MARK_REPLACED", "MARK_EXPIRED"}
MAX_COMPUTE_ROWS = 2000


@dataclass
class FdrListParams:
    search: str | None = None
    statuses: list[str] = field(default_factory=list)
    verification_status: str | None = None
    institution_id: str | None = None
    maturity: str | None = None
    priority_min: int | None = None
    discrepancy: str | None = None
    sort: str = "maturity_asc"
    page: int = 1
    page_size: int = 20


def today_for(auth: AuthContext) -> date:
    return business_today(auth.settings.business_timezone)


def _institution_map(db: Session, fdrs: list[FdrRecord]) -> dict[str, Institution]:
    ids = {fdr.institution_id for fdr in fdrs}
    if not ids:
        return {}
    return {
        inst.id: inst
        for inst in db.execute(select(Institution).where(Institution.id.in_(ids))).scalars()
    }


def _user_names(db: Session, ids: set[str]) -> dict[str, str]:
    clean = {value for value in ids if value}
    if not clean:
        return {}
    return {
        user.id: user.name
        for user in db.execute(select(User).where(User.id.in_(clean))).scalars()
    }


def _workflow(
    db: Session,
    fdr: FdrRecord,
    *,
    actor: User | None,
    action: str,
    from_state: str | None,
    to_state: str | None,
    reason: str | None,
) -> None:
    db.add(
        WorkflowEvent(
            fdr_id=fdr.id,
            actor_id=actor.id if actor else None,
            actor_label=actor.email if actor else "system (automated job)",
            from_state=from_state,
            to_state=to_state,
            action=action,
            reason=reason,
        )
    )


def _validate_dates(issue: date, maturity: date, today: date) -> None:
    if issue > today:
        raise validation_error(
            "Issue date cannot be in the future.",
            [{"field": "issue_date", "message": "Issue date cannot be in the future."}],
        )
    if maturity <= issue:
        raise validation_error(
            "Maturity date must be after the issue date.",
            [{"field": "maturity_date", "message": "Maturity date must be after the issue date."}],
        )
    if (maturity - issue).days > 365 * 20:
        raise validation_error(
            "Tenure longer than 20 years is not supported.",
            [{"field": "maturity_date", "message": "Tenure longer than 20 years is not supported."}],
        )


def _ensure_reference_unique(
    db: Session, institution_id: str, reference: str, *, exclude_id: str | None = None
) -> None:
    stmt = select(FdrRecord.id).where(
        FdrRecord.institution_id == institution_id,
        func.lower(FdrRecord.reference_number) == reference.lower(),
    )
    if exclude_id:
        stmt = stmt.where(FdrRecord.id != exclude_id)
    if db.execute(stmt.limit(1)).first():
        raise conflict(
            "An FDR with this reference number already exists for your institution.",
            code="DUPLICATE_REFERENCE",
        )


def _check_version(fdr: FdrRecord, expected_version: int | None) -> None:
    if expected_version is not None and expected_version != fdr.version:
        raise conflict(
            "This record changed since you loaded it. Reload and try again.",
            code="STALE_RECORD",
        )


def create_fdr(db: Session, auth: AuthContext, payload: FdrCreate) -> FdrRecord:
    user = auth.user
    if user.role != Role.INSTITUTION_ADMIN.value:
        raise forbidden("Only an institution administrator can submit FDR records.")
    if not user.institution_id:
        raise validation_error("Your account is not linked to an institution.")
    institution = db.get(Institution, user.institution_id)
    if institution is None or institution.status != "ACTIVE":
        raise conflict("Your institution is not active. Contact an administrator.", code="INSTITUTION_INACTIVE")

    today = today_for(auth)
    _validate_dates(payload.issue_date, payload.maturity_date, today)
    _ensure_reference_unique(db, institution.id, payload.reference_number)

    fdr = FdrRecord(
        id=new_id(),
        institution_id=institution.id,
        reference_number=payload.reference_number,
        bank_name=payload.bank_name,
        bank_code=payload.bank_code,
        amount_paise=validate_amount(payload.amount),
        currency=payload.currency,
        issue_date=payload.issue_date,
        maturity_date=payload.maturity_date,
        lifecycle_status=LifecycleStatus.DRAFT.value,
        verification_status=VerificationStatus.UNVERIFIED.value,
        notes=payload.notes,
        created_by=user.id,
    )
    db.add(fdr)
    db.flush()

    record_audit(
        db,
        actor=user,
        entity_type="FDR",
        entity_id=fdr.id,
        action="FDR_CREATED",
        payload={
            "reference_number": fdr.reference_number,
            "institution_id": institution.id,
            "amount": paise_to_decimal_string(fdr.amount_paise),
            "bank_name": fdr.bank_name,
            "issue_date": fdr.issue_date.isoformat(),
            "maturity_date": fdr.maturity_date.isoformat(),
            "lifecycle_status": fdr.lifecycle_status,
        },
    )
    _workflow(
        db,
        fdr,
        actor=user,
        action="CREATED",
        from_state=None,
        to_state=fdr.lifecycle_status,
        reason=None,
    )

    if payload.submit_for_review:
        apply_transition(
            db,
            auth,
            fdr,
            action="SUBMIT",
            reason="Submitted with the initial record.",
            expected_version=None,
        )

    db.commit()
    db.refresh(fdr)
    return fdr


def update_fdr(db: Session, auth: AuthContext, fdr: FdrRecord, changes: dict, expected_version: int | None) -> FdrRecord:
    assert_institution_owner(auth, fdr)
    if fdr.lifecycle_status not in EDITABLE_STATES:
        raise conflict(
            "Only draft or correction-required records can be edited. Ask a reviewer to return the record first.",
            code="NOT_EDITABLE",
        )
    _check_version(fdr, expected_version)

    allowed = {"reference_number", "bank_name", "bank_code", "amount", "issue_date", "maturity_date", "notes"}
    applied: dict[str, dict] = {}
    for key, value in changes.items():
        if key not in allowed or value is None:
            continue
        if key == "amount":
            new_paise = validate_amount(value)
            if new_paise != fdr.amount_paise:
                applied["amount"] = {
                    "from": paise_to_decimal_string(fdr.amount_paise),
                    "to": paise_to_decimal_string(new_paise),
                }
                fdr.amount_paise = new_paise
            continue
        current = getattr(fdr, key)
        if current != value:
            applied[key] = {"from": current, "to": value}
            setattr(fdr, key, value)

    if not applied:
        return fdr

    _validate_dates(fdr.issue_date, fdr.maturity_date, today_for(auth))
    if "reference_number" in applied:
        _ensure_reference_unique(
            db, fdr.institution_id, fdr.reference_number, exclude_id=fdr.id
        )

    fdr.version += 1
    record_audit(
        db,
        actor=auth.user,
        entity_type="FDR",
        entity_id=fdr.id,
        action="FDR_UPDATED",
        payload={"changes": {k: {kk: str(vv) for kk, vv in v.items()} for k, v in applied.items()}},
    )
    db.commit()
    db.refresh(fdr)
    return fdr


def apply_transition(
    db: Session,
    auth: AuthContext | None,
    fdr: FdrRecord,
    *,
    action: str,
    reason: str | None = None,
    expected_version: int | None = None,
    system: bool = False,
) -> FdrRecord:
    """The single place where lifecycle state changes are validated and applied."""
    rule = transition_for(action)
    if rule is None:
        raise validation_error(
            "Unknown lifecycle action.",
            [{"field": "action", "message": "Unknown lifecycle action."}],
        )

    # Authorisation is checked before state so an unauthorised role always gets
    # 403 rather than learning about record state.
    if system:
        if action not in SYSTEM_ACTIONS:
            raise forbidden("This action requires a user with the appropriate role.")
    else:
        if auth is None:
            raise forbidden("This action requires a signed-in user.")
        if auth.user.role not in rule.roles:
            raise forbidden("You don't have permission to perform this action.")
        if RuleRole.institution_only(rule) and auth.user.institution_id != fdr.institution_id:
            raise not_found("FDR record")

    if fdr.lifecycle_status in _TERMINAL_SET:
        raise conflict(
            "This record is closed and cannot change state.",
            code="INVALID_TRANSITION",
        )

    if fdr.lifecycle_status not in rule.from_states:
        raise conflict(
            f"This action is not allowed from the current state ({fdr.lifecycle_status}).",
            code="INVALID_TRANSITION",
        )

    if rule.reason_required and not (reason and len(reason.strip()) >= 5):
        raise validation_error(
            f"{rule.label} requires a reason.",
            [{"field": "reason", "message": "Record a reason of at least 5 characters."}],
        )

    if auth is not None and fdr.lifecycle_status in EDITABLE_STATES:
        assert_fdr_read(auth, fdr)

    _check_version(fdr, expected_version)

    actor = None if system or auth is None else auth.user
    from_state = fdr.lifecycle_status
    now = utcnow()

    fdr.lifecycle_status = rule.to_state
    fdr.version += 1
    if action == "SUBMIT":
        fdr.submitted_at = now
    elif action == "VERIFY":
        fdr.verified_at = now
        fdr.verification_status = VerificationStatus.MANUAL_CONFIRMED.value
        db.add(
            VerificationCheck(
                fdr_id=fdr.id,
                method="MANUAL",
                provider="Manual document review",
                result="MANUALLY_CONFIRMED",
                checked_by=auth.user.id,
                notes=reason,
                simulated=False,
            )
        )
    elif action == "ACTIVATE":
        fdr.activated_at = now

    _workflow(
        db,
        fdr,
        actor=actor,
        action=action,
        from_state=from_state,
        to_state=rule.to_state,
        reason=reason,
    )
    record_audit(
        db,
        actor=actor,
        entity_type="FDR",
        entity_id=fdr.id,
        action="FDR_TRANSITION",
        payload={
            "action": action,
            "from_state": from_state,
            "to_state": rule.to_state,
            "reason": reason,
        },
    )

    if action == "VERIFY":
        _close_predecessor_if_renewal(db, fdr)

    db.flush()
    return fdr


_TERMINAL_SET = set(TERMINAL_STATES)


class RuleRole:
    @staticmethod
    def institution_only(rule) -> bool:
        return rule.roles == {Role.INSTITUTION_ADMIN.value}


def _close_predecessor_if_renewal(db: Session, successor: FdrRecord) -> None:
    link = db.execute(
        select(RenewalLink).where(RenewalLink.successor_fdr_id == successor.id)
    ).scalar_one_or_none()
    if link is None:
        return
    predecessor = db.get(FdrRecord, link.previous_fdr_id)
    if predecessor is None or predecessor.lifecycle_status != LifecycleStatus.RENEWAL_PENDING.value:
        return
    predecessor.lifecycle_status = LifecycleStatus.REPLACED.value
    predecessor.version += 1
    _workflow(
        db,
        predecessor,
        actor=None,
        action="MARK_REPLACED",
        from_state=LifecycleStatus.RENEWAL_PENDING.value,
        to_state=LifecycleStatus.REPLACED.value,
        reason=f"Successor FDR {successor.reference_number} was verified.",
    )
    record_audit(
        db,
        actor=None,
        entity_type="FDR",
        entity_id=predecessor.id,
        action="FDR_TRANSITION",
        payload={
            "action": "MARK_REPLACED",
            "from_state": LifecycleStatus.RENEWAL_PENDING.value,
            "to_state": LifecycleStatus.REPLACED.value,
            "successor_id": successor.id,
            "successor_reference": successor.reference_number,
        },
    )


def transition_fdr(
    db: Session, auth: AuthContext, fdr: FdrRecord, payload: TransitionRequest
) -> FdrRecord:
    apply_transition(
        db,
        auth,
        fdr,
        action=payload.action,
        reason=payload.reason,
        expected_version=payload.expected_version,
    )
    db.commit()
    db.refresh(fdr)
    return fdr


def get_fdr(db: Session, auth: AuthContext, fdr_id: str) -> FdrRecord:
    fdr = db.get(FdrRecord, fdr_id)
    if fdr is None:
        raise not_found("FDR record")
    assert_fdr_read(auth, fdr)
    return fdr


def _build_stmt(auth: AuthContext, params: FdrListParams):
    stmt = select(FdrRecord)
    if not auth.is_global:
        stmt = stmt.where(FdrRecord.institution_id == auth.user.institution_id)
    elif params.institution_id:
        stmt = stmt.where(FdrRecord.institution_id == params.institution_id)

    if params.search:
        like = f"%{params.search.strip().lower()}%"
        stmt = stmt.outerjoin(Institution, Institution.id == FdrRecord.institution_id).where(
            or_(
                func.lower(FdrRecord.reference_number).like(like),
                func.lower(FdrRecord.bank_name).like(like),
                func.lower(Institution.name).like(like),
            )
        )
    if params.statuses:
        stmt = stmt.where(FdrRecord.lifecycle_status.in_(params.statuses))
    if params.verification_status:
        stmt = stmt.where(FdrRecord.verification_status == params.verification_status)

    today = business_today(auth.settings.business_timezone)
    if params.maturity in {"7", "15", "30", "90"}:
        limit = today + timedelta(days=int(params.maturity))
        stmt = stmt.where(
            FdrRecord.maturity_date >= today, FdrRecord.maturity_date <= limit
        )
    elif params.maturity == "overdue":
        stmt = stmt.where(FdrRecord.maturity_date < today)
    elif params.maturity == "upcoming":
        stmt = stmt.where(FdrRecord.maturity_date >= today)
    return stmt


def search_fdrs(
    db: Session, auth: AuthContext, params: FdrListParams
) -> tuple[list[tuple[FdrRecord, FdrMetrics, object]], int, bool]:
    """Returns (rows, total, computed_in_memory)."""
    stmt = _build_stmt(auth, params)
    today = business_today(auth.settings.business_timezone)
    needs_computation = bool(
        params.sort == "priority_desc"
        or params.priority_min is not None
        or params.discrepancy
    )

    if needs_computation:
        rows = (
            db.execute(stmt.order_by(FdrRecord.maturity_date.asc()).limit(MAX_COMPUTE_ROWS))
            .scalars()
            .all()
        )
        metrics = collect_metrics(db, rows, settings=auth.settings)
        enriched = [
            (row, metrics[row.id], priority_for(row, metrics[row.id], settings=auth.settings, today=today))
            for row in rows
        ]
        if params.priority_min is not None:
            enriched = [item for item in enriched if item[2].score >= params.priority_min]
        if params.discrepancy == "with":
            enriched = [item for item in enriched if item[1].unresolved_discrepancies > 0]
        elif params.discrepancy == "without":
            enriched = [item for item in enriched if item[1].unresolved_discrepancies == 0]
        if params.sort == "priority_desc":
            enriched.sort(key=lambda item: (-item[2].score, item[0].maturity_date))
        else:
            enriched.sort(key=lambda item: item[0].maturity_date)
        total = len(enriched)
        start = (params.page - 1) * params.page_size
        return enriched[start : start + params.page_size], total, True

    total = db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar_one()

    sort_map = {
        "maturity_asc": (FdrRecord.maturity_date.asc(), FdrRecord.created_at.desc()),
        "maturity_desc": (FdrRecord.maturity_date.desc(), FdrRecord.created_at.desc()),
        "amount_desc": (FdrRecord.amount_paise.desc(),),
        "created_desc": (FdrRecord.created_at.desc(),),
        "status": (FdrRecord.lifecycle_status.asc(), FdrRecord.maturity_date.asc()),
    }
    order = sort_map.get(params.sort, sort_map["maturity_asc"])
    rows = (
        db.execute(
            stmt.order_by(*order)
            .offset((params.page - 1) * params.page_size)
            .limit(params.page_size)
        )
        .scalars()
        .all()
    )
    metrics = collect_metrics(db, rows, settings=auth.settings)
    enriched = [
        (row, metrics[row.id], priority_for(row, metrics[row.id], settings=auth.settings, today=today))
        for row in rows
    ]
    return enriched, total, False


def serialize_summaries(db: Session, auth: AuthContext, rows) -> list[dict]:
    institutions = _institution_map(db, [row[0] for row in rows])
    today = business_today(auth.settings.business_timezone)
    return [
        fdr_summary(
            fdr,
            institution=institutions.get(fdr.institution_id),
            metrics=metrics,
            priority=priority,
            today=today,
        )
        for fdr, metrics, priority in rows
    ]


def _renewal_payload(db: Session, fdr: FdrRecord) -> dict:
    successor_links = (
        db.execute(select(RenewalLink).where(RenewalLink.previous_fdr_id == fdr.id))
        .scalars()
        .all()
    )
    predecessor_link = db.execute(
        select(RenewalLink).where(RenewalLink.successor_fdr_id == fdr.id)
    ).scalar_one_or_none()

    successors = []
    for link in successor_links:
        successor = db.get(FdrRecord, link.successor_fdr_id)
        if successor:
            successors.append(
                {
                    "id": successor.id,
                    "reference_number": successor.reference_number,
                    "lifecycle_status": successor.lifecycle_status,
                    "relationship_type": link.relationship_type,
                    "created_at": link.created_at.isoformat() + "Z",
                }
            )
    predecessor = None
    if predecessor_link:
        previous = db.get(FdrRecord, predecessor_link.previous_fdr_id)
        if previous:
            predecessor = {
                "id": previous.id,
                "reference_number": previous.reference_number,
                "lifecycle_status": previous.lifecycle_status,
                "relationship_type": predecessor_link.relationship_type,
                "created_at": predecessor_link.created_at.isoformat() + "Z",
            }
    return {
        "predecessor": predecessor,
        "successors": successors,
        "is_renewal_successor": predecessor is not None,
    }


def build_detail(db: Session, auth: AuthContext, fdr: FdrRecord) -> dict:
    documents = (
        db.execute(
            select(FdrDocument)
            .where(FdrDocument.fdr_id == fdr.id)
            .options(selectinload(FdrDocument.extractions))
            .order_by(FdrDocument.uploaded_at.asc())
        )
        .scalars()
        .all()
    )
    workflow_events = (
        db.execute(
            select(WorkflowEvent)
            .where(WorkflowEvent.fdr_id == fdr.id)
            .order_by(WorkflowEvent.created_at.asc())
        )
        .scalars()
        .all()
    )
    verification_checks = (
        db.execute(
            select(VerificationCheck)
            .where(VerificationCheck.fdr_id == fdr.id)
            .order_by(VerificationCheck.checked_at.desc())
        )
        .scalars()
        .all()
    )
    release_requests = (
        db.execute(
            select(ReleaseRequest)
            .where(ReleaseRequest.fdr_id == fdr.id)
            .order_by(ReleaseRequest.requested_at.desc())
        )
        .scalars()
        .all()
    )
    audit_rows = (
        db.execute(
            select(AuditEvent)
            .where(AuditEvent.entity_type == "FDR", AuditEvent.entity_id == fdr.id)
            .order_by(AuditEvent.sequence.desc())
            .limit(100)
        )
        .scalars()
        .all()
    )

    metrics = collect_metrics(db, [fdr], settings=auth.settings)[fdr.id]
    institution = db.get(Institution, fdr.institution_id)
    today = business_today(auth.settings.business_timezone)
    priority = priority_for(fdr, metrics, settings=auth.settings, today=today)
    created_by = db.get(User, fdr.created_by)
    checker_ids = {req.checker_id for req in release_requests if req.checker_id}
    requester_ids = {req.requested_by for req in release_requests}
    names = _user_names(db, checker_ids | requester_ids | {fdr.released_by or ""})

    role = auth.user.role
    is_owner = auth.user.institution_id == fdr.institution_id
    pending = metrics.pending_release

    permissions = {
        "role": role,
        "is_institution_user": role == Role.INSTITUTION_ADMIN.value,
        "can_edit": role == Role.INSTITUTION_ADMIN.value
        and is_owner
        and fdr.lifecycle_status in EDITABLE_STATES,
        "can_upload_document": role == Role.INSTITUTION_ADMIN.value
        and is_owner
        and fdr.lifecycle_status in EDITABLE_STATES,
        "can_extract": role == Role.REVIEWING_OFFICER.value
        and fdr.lifecycle_status
        in {
            LifecycleStatus.SUBMITTED.value,
            LifecycleStatus.UNDER_REVIEW.value,
            LifecycleStatus.CORRECTION_REQUIRED.value,
            LifecycleStatus.VERIFIED.value,
        },
        "can_review_extractions": role == Role.REVIEWING_OFFICER.value
        and fdr.lifecycle_status == LifecycleStatus.UNDER_REVIEW.value,
        "can_record_verification": role == Role.REVIEWING_OFFICER.value
        and fdr.lifecycle_status == LifecycleStatus.UNDER_REVIEW.value,
        "can_request_release": role == Role.INSTITUTION_ADMIN.value
        and is_owner
        and fdr.lifecycle_status
        in (RELEASABLE_STATES | {LifecycleStatus.RELEASE_REQUESTED.value})
        and pending is None,
        "can_renew": (
            (role == Role.INSTITUTION_ADMIN.value and is_owner)
            or role == Role.REVIEWING_OFFICER.value
        )
        and fdr.lifecycle_status in RENEWABLE_STATES,
        "can_decide_release": role == Role.APPROVING_OFFICER.value and pending is not None,
        "pending_release_id": pending.id if pending else None,
    }

    release_payload = []
    for request in release_requests:
        release_payload.append(
            release_public(
                request,
                requester=db.get(User, request.requested_by),
                checker=db.get(User, request.checker_id) if request.checker_id else None,
                fdr=fdr,
                institution=institution,
                approval_sla_hours=auth.settings.approval_sla_hours,
            )
        )

    return fdr_detail(
        fdr,
        institution=institution,
        metrics=metrics,
        priority=priority,
        today=today,
        documents=list(documents),
        workflow_events=list(workflow_events),
        verification_checks=list(verification_checks),
        release_requests=release_payload,
        audit_events=[audit_public(event) for event in audit_rows],
        renewal=_renewal_payload(db, fdr),
        permissions=permissions,
        user_names=names,
        notes=fdr.notes,
        created_by=created_by,
    )


def renew_fdr(db: Session, auth: AuthContext, fdr: FdrRecord, payload: RenewalRequest) -> FdrRecord:
    is_owner = auth.user.institution_id == fdr.institution_id
    if auth.user.role == Role.INSTITUTION_ADMIN.value and not is_owner:
        raise not_found("FDR record")
    if auth.user.role not in {Role.INSTITUTION_ADMIN.value, Role.REVIEWING_OFFICER.value}:
        raise forbidden("You don't have permission to renew this record.")
    if fdr.lifecycle_status not in RENEWABLE_STATES:
        raise conflict(
            "A renewal can only be started from a verified, active or maturing record.",
            code="INVALID_TRANSITION",
        )
    today = today_for(auth)
    fields = payload.new_fdr
    _validate_dates(fields.issue_date, fields.maturity_date, today)
    _ensure_reference_unique(db, fdr.institution_id, fields.reference_number)

    successor = FdrRecord(
        id=new_id(),
        institution_id=fdr.institution_id,
        reference_number=fields.reference_number,
        bank_name=fields.bank_name,
        bank_code=fields.bank_code,
        amount_paise=validate_amount(fields.amount),
        currency=fields.currency,
        issue_date=fields.issue_date,
        maturity_date=fields.maturity_date,
        lifecycle_status=LifecycleStatus.SUBMITTED.value,
        verification_status=VerificationStatus.UNVERIFIED.value,
        notes=fields.notes,
        created_by=auth.user.id,
        submitted_at=utcnow(),
    )
    db.add(successor)
    db.flush()
    db.add(
        RenewalLink(
            previous_fdr_id=fdr.id,
            successor_fdr_id=successor.id,
            relationship_type=payload.relationship_type,
            created_by=auth.user.id,
        )
    )

    previous_state = fdr.lifecycle_status
    fdr.lifecycle_status = LifecycleStatus.RENEWAL_PENDING.value
    fdr.version += 1
    _workflow(
        db,
        fdr,
        actor=auth.user,
        action="RENEWAL_STARTED",
        from_state=previous_state,
        to_state=fdr.lifecycle_status,
        reason=payload.reason,
    )
    _workflow(
        db,
        successor,
        actor=auth.user,
        action="RENEWAL_SUCCESSOR_CREATED",
        from_state=None,
        to_state=successor.lifecycle_status,
        reason=payload.reason,
    )
    record_audit(
        db,
        actor=auth.user,
        entity_type="FDR",
        entity_id=fdr.id,
        action="RENEWAL_CREATED",
        payload={
            "relationship_type": payload.relationship_type,
            "reason": payload.reason,
            "successor_id": successor.id,
            "successor_reference": successor.reference_number,
            "from_state": previous_state,
            "to_state": fdr.lifecycle_status,
        },
    )
    record_audit(
        db,
        actor=auth.user,
        entity_type="FDR",
        entity_id=successor.id,
        action="FDR_CREATED",
        payload={
            "reference_number": successor.reference_number,
            "institution_id": successor.institution_id,
            "amount": paise_to_decimal_string(successor.amount_paise),
            "bank_name": successor.bank_name,
            "issue_date": successor.issue_date.isoformat(),
            "maturity_date": successor.maturity_date.isoformat(),
            "predecessor_id": fdr.id,
            "predecessor_reference": fdr.reference_number,
        },
    )
    db.commit()
    db.refresh(successor)
    return successor


def review_extractions(
    db: Session, auth: AuthContext, fdr: FdrRecord, reviews: list[dict], note: str | None
) -> None:
    if auth.user.role != Role.REVIEWING_OFFICER.value:
        raise forbidden("Only a reviewing officer can record extraction review outcomes.")
    if fdr.lifecycle_status != LifecycleStatus.UNDER_REVIEW.value:
        raise conflict(
            "Extraction review is only available while the record is under review.",
            code="INVALID_TRANSITION",
        )
    documents = (
        db.execute(
            select(FdrDocument)
            .where(FdrDocument.fdr_id == fdr.id)
            .options(selectinload(FdrDocument.extractions))
        )
        .scalars()
        .all()
    )
    by_id = {
        extraction.id: extraction
        for document in documents
        for extraction in document.extractions
    }
    applied = []
    for review in reviews:
        extraction = by_id.get(review["extraction_id"])
        if extraction is None:
            raise not_found("Extracted field")
        extraction.review_status = review["review_status"]
        extraction.corrected_value = review.get("corrected_value")
        extraction.reviewed_by = auth.user.id
        extraction.reviewed_at = utcnow()
        applied.append(
            {
                "extraction_id": extraction.id,
                "field_name": extraction.field_name,
                "review_status": extraction.review_status,
                "corrected_value": extraction.corrected_value,
            }
        )
    record_audit(
        db,
        actor=auth.user,
        entity_type="FDR",
        entity_id=fdr.id,
        action="EXTRACTION_REVIEWED",
        payload={"reviews": applied, "note": note},
    )
    _workflow(
        db,
        fdr,
        actor=auth.user,
        action="EXTRACTION_REVIEWED",
        from_state=fdr.lifecycle_status,
        to_state=fdr.lifecycle_status,
        reason=note,
    )
    db.commit()


def needs_attention(db: Session, auth: AuthContext, limit: int = 6) -> list[dict]:
    stmt = select(FdrRecord)
    if not auth.is_global:
        stmt = stmt.where(FdrRecord.institution_id == auth.user.institution_id)
    stmt = stmt.where(FdrRecord.lifecycle_status.in_(OPEN_STATES)).limit(MAX_COMPUTE_ROWS)
    rows = db.execute(stmt).scalars().all()
    metrics = collect_metrics(db, rows, settings=auth.settings)
    today = business_today(auth.settings.business_timezone)
    enriched = [
        (row, metrics[row.id], priority_for(row, metrics[row.id], settings=auth.settings, today=today))
        for row in rows
    ]
    enriched.sort(key=lambda item: (-item[2].score, item[0].maturity_date))
    return serialize_summaries(db, auth, enriched[:limit])


def scoped_ids(db: Session, auth: AuthContext) -> list[str]:
    stmt = select(FdrRecord.id)
    if not auth.is_global:
        stmt = stmt.where(FdrRecord.institution_id == auth.user.institution_id)
    return list(db.execute(stmt).scalars())
