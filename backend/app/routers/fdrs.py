"""FDR record endpoints."""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from ..deps import AuthContext, get_auth, get_db
from ..schemas import (
    ExtractionReviewRequest,
    FdrCreate,
    FdrUpdate,
    RenewalRequest,
    TransitionRequest,
    VerificationRequest,
)
from ..serializers import document_public
from ..services import documents as document_service
from ..services import fdr as fdr_service
from ..services import verification as verification_service
from ..services.documents import discrepancies_for
from ..services.fdr import FdrListParams, build_detail, get_fdr, serialize_summaries
from ..services.fdr import create_fdr, renew_fdr, review_extractions, search_fdrs, transition_fdr, update_fdr
from .common import fdr_list_params

router = APIRouter(prefix="/fdrs", tags=["fdrs"])


@router.get("")
def list_fdrs(
    params: FdrListParams = Depends(fdr_list_params),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    rows, total, computed = search_fdrs(db, auth, params)
    items = serialize_summaries(db, auth, rows)
    return {
        "items": items,
        "total": total,
        "page": params.page,
        "page_size": params.page_size,
        "pages": max(1, math.ceil(total / params.page_size)) if total else 0,
        "computed_in_memory": computed,
    }


@router.post("")
def create(
    payload: FdrCreate,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    fdr = create_fdr(db, auth, payload)
    return build_detail(db, auth, fdr)


@router.get("/{fdr_id}")
def detail(
    fdr_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    fdr = get_fdr(db, auth, fdr_id)
    return build_detail(db, auth, fdr)


@router.patch("/{fdr_id}")
def update(
    fdr_id: str,
    payload: FdrUpdate,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    fdr = get_fdr(db, auth, fdr_id)
    changes = payload.model_dump(exclude_unset=True, exclude={"expected_version"})
    fdr = update_fdr(db, auth, fdr, changes, payload.expected_version)
    return build_detail(db, auth, fdr)


@router.post("/{fdr_id}/transition")
def transition(
    fdr_id: str,
    payload: TransitionRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    fdr = get_fdr(db, auth, fdr_id)
    fdr = transition_fdr(db, auth, fdr, payload)
    return build_detail(db, auth, fdr)


@router.post("/{fdr_id}/verification")
def verification(
    fdr_id: str,
    payload: VerificationRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    fdr = get_fdr(db, auth, fdr_id)
    verification_service.record_verification(db, auth, fdr, payload)
    return build_detail(db, auth, fdr)


@router.post("/{fdr_id}/extraction-review")
def extraction_review(
    fdr_id: str,
    payload: ExtractionReviewRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    fdr = get_fdr(db, auth, fdr_id)
    review_extractions(
        db,
        auth,
        fdr,
        [review.model_dump() for review in payload.reviews],
        payload.note,
    )
    return build_detail(db, auth, fdr)


@router.post("/{fdr_id}/renewals")
def renewal(
    fdr_id: str,
    payload: RenewalRequest,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    fdr = get_fdr(db, auth, fdr_id)
    successor = renew_fdr(db, auth, fdr, payload)
    return {
        "successor_id": successor.id,
        "successor_reference": successor.reference_number,
        "predecessor_id": fdr.id,
        "lifecycle_status": successor.lifecycle_status,
    }


@router.get("/{fdr_id}/discrepancies")
def discrepancies(
    fdr_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    fdr = get_fdr(db, auth, fdr_id)
    return discrepancies_for(db, auth, fdr)


@router.post("/{fdr_id}/documents")
async def upload_document(
    fdr_id: str,
    file: UploadFile = File(...),
    document_type: str = Form(default="FDR_RECEIPT"),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    fdr = get_fdr(db, auth, fdr_id)
    document = await document_service.save_document(
        db, auth, fdr, file, document_type=document_type
    )
    # Extract immediately so the discrepancy panel is usable; failures are
    # recorded on the document and never imply verification.
    document = document_service.run_extraction(db, auth, document)
    from sqlalchemy import select

    from ..models import FdrDocument

    refreshed = db.execute(
        select(FdrDocument).where(FdrDocument.id == document.id)
    ).scalar_one()
    return document_public(refreshed)


@router.get("/{fdr_id}/audit-events")
def fdr_audit(
    fdr_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    fdr = get_fdr(db, auth, fdr_id)
    detail = build_detail(db, auth, fdr)
    return {"items": detail["audit_events"]}
