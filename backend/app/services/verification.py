"""Verification adapter.

No authorised bank API, credentials or dataset is available for this prototype.
The default mode is therefore MANUAL. A clearly labelled simulated adapter can
be enabled for demonstration only; its result is never treated as a bank
confirmation and never sets the record to independently confirmed.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from ..audit import record_audit
from ..deps import AuthContext
from ..domain import LifecycleStatus, Role, VerificationStatus
from ..errors import ApiError, conflict, forbidden, validation_error
from ..models import FdrRecord, VerificationCheck, WorkflowEvent, utcnow
from ..schemas import VerificationRequest

SIMULATED_PROVIDER = "simulated-bank-adapter"
SIMULATED_LABEL = "SIMULATED — NOT A BANK CONFIRMATION"


@dataclass
class AdapterResult:
    status: str
    reference: str | None
    detail: str
    simulated: bool


def verify_fdr(
    *,
    reference_number: str,
    bank_code: str | None,
    amount_paise: int,
    issue_date: date,
    maturity_date: date,
    mode: str,
) -> AdapterResult:
    """Provider-shaped interface used by the review workflow."""
    if mode == "manual":
        return AdapterResult(
            status="NOT_CONFIGURED",
            reference=None,
            detail=(
                "No authorised bank verification provider is configured. "
                "Record a manual review instead."
            ),
            simulated=False,
        )
    if mode == "simulated":
        digest = hashlib.sha256(
            f"{reference_number}|{bank_code}|{amount_paise}|{issue_date}|{maturity_date}".encode("utf-8")
        ).hexdigest()
        matched = int(digest[:2], 16) % 2 == 0
        return AdapterResult(
            status="SIMULATED_MATCH" if matched else "SIMULATED_MISMATCH",
            reference=f"SIM-{digest[:12].upper()}",
            detail=(
                f"{SIMULATED_LABEL}. This result is generated locally from a hash of the "
                "submitted values and carries no evidentiary weight."
            ),
            simulated=True,
        )
    return AdapterResult(
        status="UNAVAILABLE",
        reference=None,
        detail="The configured verification adapter is unavailable.",
        simulated=False,
    )


def record_verification(
    db: Session, auth: AuthContext, fdr: FdrRecord, payload: VerificationRequest
) -> VerificationCheck:
    if auth.user.role != Role.REVIEWING_OFFICER.value:
        raise forbidden("Only a reviewing officer can record a verification outcome.")
    if fdr.lifecycle_status != LifecycleStatus.UNDER_REVIEW.value:
        raise conflict(
            "Verification can only be recorded while the record is under review.",
            code="INVALID_TRANSITION",
        )
    if payload.expected_version is not None and payload.expected_version != fdr.version:
        raise conflict(
            "This record changed since you loaded it. Reload and try again.",
            code="STALE_RECORD",
        )

    if payload.method == "MANUAL":
        if not (payload.notes and len(payload.notes) >= 5):
            raise validation_error(
                "Describe what was checked for a manual verification.",
                [{"field": "notes", "message": "Describe the documents or details you checked."}],
            )
        check = VerificationCheck(
            fdr_id=fdr.id,
            method="MANUAL",
            provider="Manual document review",
            result="MANUALLY_CONFIRMED",
            checked_by=auth.user.id,
            notes=payload.notes,
            evidence_reference=payload.evidence_reference,
            simulated=False,
        )
        fdr.verification_status = VerificationStatus.MANUAL_CONFIRMED.value
    else:
        result = verify_fdr(
            reference_number=fdr.reference_number,
            bank_code=fdr.bank_code,
            amount_paise=fdr.amount_paise,
            issue_date=fdr.issue_date,
            maturity_date=fdr.maturity_date,
            mode=auth.settings.bank_verification_mode,
        )
        if result.status == "NOT_CONFIGURED":
            raise ApiError(
                409,
                "PROVIDER_NOT_CONFIGURED",
                result.detail,
                hint="Record a manual verification, or ask an administrator to configure an adapter.",
            )
        check = VerificationCheck(
            fdr_id=fdr.id,
            method="PROVIDER",
            provider=SIMULATED_PROVIDER if result.simulated else "bank-adapter",
            result=result.status,
            checked_by=auth.user.id,
            evidence_reference=result.reference,
            notes=result.detail,
            simulated=result.simulated,
        )
        if result.simulated:
            fdr.verification_status = VerificationStatus.SIMULATION_ONLY.value
        elif result.status == "MATCH":
            fdr.verification_status = VerificationStatus.MANUAL_CONFIRMED.value
        elif result.status == "MISMATCH":
            fdr.verification_status = VerificationStatus.MISMATCH_REPORTED.value
        else:
            fdr.verification_status = VerificationStatus.FAILED_VERIFICATION.value

    db.add(check)
    fdr.version += 1
    db.add(
        WorkflowEvent(
            fdr_id=fdr.id,
            actor_id=auth.user.id,
            actor_label=auth.user.email,
            from_state=fdr.lifecycle_status,
            to_state=fdr.lifecycle_status,
            action="VERIFICATION_RECORDED",
            reason=payload.notes,
        )
    )
    record_audit(
        db,
        actor=auth.user,
        entity_type="FDR",
        entity_id=fdr.id,
        action="VERIFICATION_RECORDED",
        payload={
            "method": check.method,
            "provider": check.provider,
            "result": check.result,
            "simulated": check.simulated,
            "notes": check.notes,
        },
    )
    db.commit()
    db.refresh(check)
    return check
