"""Private supporting-document storage, authorised access, and extraction runs."""

from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..audit import record_audit
from ..config import Settings
from ..deps import AuthContext, assert_fdr_read
from ..domain import (
    EDITABLE_STATES,
    ExtractionStatus,
    LifecycleStatus,
    Role,
)
from ..errors import ApiError, conflict, forbidden, not_found, validation_error
from ..models import FdrDocument, FdrRecord, OcrExtraction, WorkflowEvent, new_id, utcnow
from ..money import paise_to_decimal_string
from .extraction import (
    ALLOWED_TYPES,
    compute_discrepancies,
    detect_content_type,
    discrepancy_summary,
    extract_document,
    unresolved_discrepancies,
)

MAX_FILENAME = 120
READ_CHUNK = 64 * 1024


def new_storage_key(extension: str) -> str:
    """Server-generated, short, opaque key (keeps paths below Windows limits)."""
    import uuid

    return f"{uuid.uuid4().hex}.{extension}"


def _sanitise_filename(name: str) -> str:
    safe = Path(name or "document").name
    safe = "".join(ch for ch in safe if ch.isprintable() and ch not in {'"', "'", "\\", "/"})
    safe = safe.strip().strip(".") or "document"
    return safe[:MAX_FILENAME]


async def save_document(
    db: Session,
    auth: AuthContext,
    fdr: FdrRecord,
    upload: UploadFile,
    *,
    document_type: str,
) -> FdrDocument:
    if auth.user.role != Role.INSTITUTION_ADMIN.value or auth.user.institution_id != fdr.institution_id:
        raise forbidden("Only the owning institution can upload documents for this record.")
    if fdr.lifecycle_status not in EDITABLE_STATES:
        raise conflict(
            "Documents can only be added while the record is a draft or awaiting correction.",
            code="NOT_EDITABLE",
        )

    settings: Settings = auth.settings
    content = await upload.read(settings.max_upload_bytes + 1)
    if not content:
        raise validation_error("The uploaded file is empty.", [{"field": "file", "message": "Choose a non-empty file."}])
    if len(content) > settings.max_upload_bytes:
        raise ApiError(
            413,
            "FILE_TOO_LARGE",
            f"Documents must be {settings.max_upload_bytes // (1024 * 1024)} MB or smaller.",
        )

    detected = detect_content_type(content[:16])
    if detected is None or detected not in ALLOWED_TYPES:
        raise validation_error(
            "Only PDF, PNG or JPEG documents are accepted.",
            [{"field": "file", "message": "Upload a PDF, PNG or JPEG file."}],
        )
    supplied_type = (upload.content_type or "").split(";")[0].strip().lower()
    if supplied_type and supplied_type not in ALLOWED_TYPES:
        raise validation_error(
            "The file type reported by the browser is not allowed.",
            [{"field": "file", "message": "Upload a PDF, PNG or JPEG file."}],
        )

    extension = ALLOWED_TYPES[detected]
    storage_key = new_storage_key(extension)
    destination = Path(settings.upload_dir) / storage_key
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)

    import hashlib

    document = FdrDocument(
        id=new_id(),
        fdr_id=fdr.id,
        storage_key=storage_key,
        original_filename=_sanitise_filename(upload.filename or f"document.{extension}"),
        content_type=detected,
        size_bytes=len(content),
        sha256_digest=hashlib.sha256(content).hexdigest(),
        document_type=document_type,
        uploaded_by=auth.user.id,
        scan_status="NOT_SCANNED",
        extraction_status=ExtractionStatus.PENDING.value,
    )
    db.add(document)
    db.flush()

    record_audit(
        db,
        actor=auth.user,
        entity_type="FDR",
        entity_id=fdr.id,
        action="DOCUMENT_UPLOADED",
        payload={
            "document_id": document.id,
            "filename": document.original_filename,
            "content_type": document.content_type,
            "size_bytes": document.size_bytes,
            "sha256_digest": document.sha256_digest,
            "document_type": document.document_type,
        },
    )
    db.add(
        WorkflowEvent(
            fdr_id=fdr.id,
            actor_id=auth.user.id,
            actor_label=auth.user.email,
            from_state=fdr.lifecycle_status,
            to_state=fdr.lifecycle_status,
            action="DOCUMENT_UPLOADED",
            reason=document.original_filename,
        )
    )
    db.commit()
    db.refresh(document)
    return document


def document_path(settings: Settings, document: FdrDocument) -> Path:
    base = Path(settings.upload_dir).resolve()
    path = (base / document.storage_key).resolve()
    if not str(path).startswith(str(base)):
        raise not_found("Document")
    if not path.exists():
        raise ApiError(410, "FILE_MISSING", "The stored document is no longer available.")
    return path


def get_document(db: Session, auth: AuthContext, document_id: str) -> tuple[FdrDocument, FdrRecord]:
    document = db.get(FdrDocument, document_id)
    if document is None:
        raise not_found("Document")
    fdr = db.get(FdrRecord, document.fdr_id)
    if fdr is None:
        raise not_found("Document")
    # Any role with read scope may view evidence for that record: the owning
    # institution, reviewers, approvers (release decisions), auditors and admins.
    assert_fdr_read(auth, fdr)
    return document, fdr


def load_documents(db: Session, fdr_id: str) -> list[FdrDocument]:
    return list(
        db.execute(
            select(FdrDocument)
            .where(FdrDocument.fdr_id == fdr_id)
            .options(selectinload(FdrDocument.extractions))
            .order_by(FdrDocument.uploaded_at.asc())
        )
        .scalars()
        .all()
    )


def discrepancies_for(db: Session, auth: AuthContext, fdr: FdrRecord) -> dict:
    assert_fdr_read(auth, fdr)
    documents = load_documents(db, fdr.id)
    institution_name = fdr.institution.name if fdr.institution else ""
    items = compute_discrepancies(fdr, institution_name, documents)
    return {
        "fdr_id": fdr.id,
        "reference_number": fdr.reference_number,
        "amount": paise_to_decimal_string(fdr.amount_paise),
        "fields": items,
        "unresolved": unresolved_discrepancies(items),
        "summary": discrepancy_summary(items),
        "has_extraction": any(doc.extractions for doc in documents),
    }


def run_extraction(db: Session, auth: AuthContext, document: FdrDocument) -> FdrDocument:
    fdr = db.get(FdrRecord, document.fdr_id)
    if fdr is None:
        raise not_found("Document")
    is_owner = auth.user.institution_id == fdr.institution_id
    allowed = (
        auth.user.role == Role.REVIEWING_OFFICER.value
        and fdr.lifecycle_status
        in {
            LifecycleStatus.SUBMITTED.value,
            LifecycleStatus.UNDER_REVIEW.value,
            LifecycleStatus.CORRECTION_REQUIRED.value,
            LifecycleStatus.VERIFIED.value,
        }
    ) or (auth.user.role == Role.INSTITUTION_ADMIN.value and is_owner and fdr.lifecycle_status in EDITABLE_STATES)
    if not allowed:
        raise forbidden("You don't have permission to run extraction for this document.")

    data = document_path(auth.settings, document).read_bytes()
    outcome = extract_document(data, document.content_type)

    db.query(OcrExtraction).filter(OcrExtraction.document_id == document.id).delete()
    for field_name, extracted in outcome.fields.items():
        db.add(
            OcrExtraction(
                document_id=document.id,
                field_name=field_name,
                extracted_value=extracted.value,
                confidence=extracted.confidence,
                page_number=extracted.page_number,
                review_status="PENDING",
            )
        )
    document.extraction_status = outcome.status
    document.extraction_engine = outcome.engine
    document.extraction_note = outcome.note
    document.extracted_at = utcnow()
    db.flush()

    record_audit(
        db,
        actor=auth.user,
        entity_type="FDR",
        entity_id=fdr.id,
        action="DOCUMENT_EXTRACTED",
        payload={
            "document_id": document.id,
            "status": outcome.status,
            "engine": outcome.engine,
            "fields": sorted(outcome.fields.keys()),
        },
    )
    db.add(
        WorkflowEvent(
            fdr_id=fdr.id,
            actor_id=auth.user.id,
            actor_label=auth.user.email,
            from_state=fdr.lifecycle_status,
            to_state=fdr.lifecycle_status,
            action="DOCUMENT_EXTRACTED",
            reason=f"{document.original_filename}: {outcome.status}",
        )
    )
    db.commit()
    db.refresh(document)
    return document
