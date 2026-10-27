"""Release requests and maker-checker decisions."""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..deps import AuthContext, get_auth, get_db
from ..models import FdrRecord, Institution, ReleaseRequest, User
from ..schemas import ReleaseDecisionRequest, ReleaseRequestCreate
from ..serializers import release_public
from ..services import release as release_service
from ..services.release import ReleaseListParams

router = APIRouter(prefix="/release-requests", tags=["release"])


def _payload(db: Session, auth: AuthContext, request: ReleaseRequest) -> dict:
    fdr = db.get(FdrRecord, request.fdr_id)
    institution = db.get(Institution, fdr.institution_id) if fdr else None
    requester = db.get(User, request.requested_by)
    checker = db.get(User, request.checker_id) if request.checker_id else None
    return release_public(
        request,
        requester=requester,
        checker=checker,
        fdr=fdr,
        institution=institution,
        approval_sla_hours=auth.settings.approval_sla_hours,
    )


@router.get("")
def list_requests(
    status: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=120),
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=20, ge=1, le=100),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    params = ReleaseListParams(status=status, search=search, page=page, page_size=page_size)
    rows, total = release_service.list_release_requests(db, auth, params)
    return {
        "items": [_payload(db, auth, row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, math.ceil(total / page_size)) if total else 0,
    }


@router.get("/{request_id}")
def get_request(
    request_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    request, _fdr = release_service.get_pending_for_checker(db, auth, request_id)
    return _payload(db, auth, request)


@router.post("")
def create_request(
    payload: ReleaseRequestCreate,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    request = release_service.create_release_request(db, auth, payload)
    return _payload(db, auth, request)


@router.post("/{request_id}/decision")
def decide_request(
    request_id: str,
    payload: ReleaseDecisionRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    request = release_service.decide_release_request(db, auth, request_id, payload)
    return _payload(db, auth, request)
