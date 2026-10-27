"""Authorised, server-mediated document access."""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..deps import AuthContext, get_auth, get_db
from ..serializers import document_public
from ..services import documents as document_service

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/{document_id}")
def download_document(
    document_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    document, _fdr = document_service.get_document(db, auth, document_id)
    path = document_service.document_path(auth.settings, document)
    filename = document.original_filename
    headers = {
        "Cache-Control": "private, no-store",
        "Content-Disposition": (
            f"attachment; filename=\"{filename.encode('ascii', 'replace').decode('ascii')}\"; "
            f"filename*=UTF-8''{quote(filename)}"
        ),
        "X-Content-Type-Options": "nosniff",
    }
    return FileResponse(path, media_type=document.content_type, headers=headers)


@router.post("/{document_id}/extract")
def extract_document(
    document_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    document, _fdr = document_service.get_document(db, auth, document_id)
    document = document_service.run_extraction(db, auth, document)
    return document_public(document)
