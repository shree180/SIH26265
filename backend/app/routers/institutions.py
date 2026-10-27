"""Institution registry."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import AuthContext, get_auth, get_db
from ..domain import Role
from ..errors import forbidden, not_found
from ..models import Institution
from ..schemas import InstitutionCreate, InstitutionUpdate
from ..serializers import institution_public
from ..services import admin as admin_service

router = APIRouter(prefix="/institutions", tags=["institutions"])


@router.get("")
def list_institutions(
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    stmt = select(Institution).order_by(Institution.name.asc())
    if not auth.is_global:
        stmt = stmt.where(Institution.id == auth.user.institution_id)
    return {"items": [institution_public(row) for row in db.execute(stmt).scalars()]}


@router.get("/{institution_id}")
def get_institution(
    institution_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    institution = db.get(Institution, institution_id)
    if institution is None:
        raise not_found("Institution")
    if not auth.is_global and auth.user.institution_id != institution.id:
        raise not_found("Institution")
    return institution_public(institution)


@router.post("")
def create_institution(
    payload: InstitutionCreate,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    if auth.user.role != Role.SYSTEM_ADMIN.value:
        raise forbidden("Only a system administrator can add institutions.")
    institution = admin_service.create_institution(
        db,
        auth,
        code=payload.institution_code,
        name=payload.name.strip(),
        contact_email=str(payload.contact_email),
    )
    return institution_public(institution)


@router.patch("/{institution_id}")
def update_institution(
    institution_id: str,
    payload: InstitutionUpdate,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    institution = admin_service.update_institution(
        db, auth, institution_id, payload.model_dump(exclude_unset=True)
    )
    return institution_public(institution)
