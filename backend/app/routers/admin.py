"""System administration, integration status, and integrity tooling."""

from __future__ import annotations

import json
import math

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import CHAIN_LIMITATION, record_audit, verify_chain
from ..deps import AuthContext, get_auth, get_db
from ..domain import Role
from ..errors import forbidden
from ..models import AuditEvent, utcnow
from ..schemas import UserAdminUpdate
from ..serializers import iso, user_public
from ..services import admin as admin_service
from ..services.notifications import ALERT_POLICY_VERSION, run_maturity_scan

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
def list_users(
    search: str | None = Query(default=None, max_length=120),
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=25, ge=1, le=100),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    if auth.user.role != Role.SYSTEM_ADMIN.value:
        raise forbidden("Only a system administrator can view users.")
    rows, total = admin_service.list_users(db, search=search, page=page, page_size=page_size)
    return {
        "items": [user_public(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, math.ceil(total / page_size)) if total else 0,
    }


@router.patch("/users/{user_id}")
def update_user(
    user_id: str,
    payload: UserAdminUpdate,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    user = admin_service.update_user(db, auth, user_id, payload.model_dump(exclude_unset=True))
    return user_public(user)


@router.get("/integrations")
def integrations(
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    if auth.user.role != Role.SYSTEM_ADMIN.value:
        raise forbidden("Only a system administrator can view integration settings.")
    settings = auth.settings
    last_scan = db.execute(
        select(AuditEvent)
        .where(AuditEvent.action == "MATURITY_SCAN_RUN")
        .order_by(AuditEvent.sequence.desc())
        .limit(1)
    ).scalar_one_or_none()
    scan_payload = {}
    if last_scan:
        try:
            scan_payload = json.loads(last_scan.event_payload)
        except json.JSONDecodeError:
            scan_payload = {}
    simulated = settings.bank_verification_mode == "simulated"
    return {
        "bank_verification": {
            "mode": settings.bank_verification_mode,
            "label": (
                "Simulated adapter — demo only"
                if simulated
                else "Manual verification (no bank provider)"
            ),
            "simulated": simulated,
            "production_ready": False,
            "detail": (
                "No authorised bank API, credentials or dataset is available. "
                "Simulated results are never treated as bank confirmation."
            ),
        },
        "extraction": {
            "engine": "pdf-text-layer",
            "image_ocr_available": False,
            "detail": (
                "PDF text-layer extraction is real but is not OCR and reports no "
                "confidence score. Install a Tesseract/PaddleOCR engine before "
                "enabling image OCR."
            ),
        },
        "storage": {
            "private_server_storage": True,
            "max_upload_mb": settings.max_upload_bytes // (1024 * 1024),
            "malware_scanning": "NOT_CONFIGURED",
        },
        "scheduler": {
            "enabled": settings.scheduler_enabled,
            "single_instance_only": True,
            "hour_utc": settings.maturity_scan_hour_utc,
            "thresholds": settings.thresholds,
            "timezone": settings.business_timezone,
            "alert_policy_version": ALERT_POLICY_VERSION,
            "last_run_at": iso(last_scan.occurred_at) if last_scan else None,
            "last_run": scan_payload,
        },
        "email_delivery": {
            "configured": False,
            "detail": "In-app notifications only. Email/SMS delivery is not configured.",
        },
        "database": {
            "dialect": db.get_bind().dialect.name,
            "production_target": "PostgreSQL",
        },
    }


@router.post("/jobs/maturity-scan")
def run_scan(
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    if auth.user.role != Role.SYSTEM_ADMIN.value:
        raise forbidden("Only a system administrator can run the maturity scan.")
    return run_maturity_scan(db, auth.settings, actor=auth.user)


@router.post("/audit/verify-chain")
def verify_audit_chain(
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    if auth.user.role not in {Role.SYSTEM_ADMIN.value, Role.AUDITOR.value}:
        raise forbidden("Only an administrator or auditor can verify the audit chain.")
    head = db.execute(
        select(AuditEvent).order_by(AuditEvent.sequence.desc()).limit(1)
    ).scalar_one_or_none()
    result = verify_chain(db)
    record_audit(
        db,
        actor=auth.user,
        entity_type="SYSTEM",
        entity_id="audit_chain",
        action="AUDIT_CHAIN_VERIFIED",
        payload={
            "valid": result["valid"],
            "checked": result["checked"],
            "broken_sequence": result["broken_sequence"],
        },
    )
    db.commit()
    return {
        **result,
        "checked_at": utcnow().isoformat() + "Z",
        "chain_head": head.event_hash if head else None,
        "limitation": CHAIN_LIMITATION,
    }
