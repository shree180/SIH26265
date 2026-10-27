"""Read-only audit history for permitted scopes."""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..deps import AuthContext, get_auth, get_db
from ..models import AuditEvent, FdrRecord, Institution, User
from ..serializers import audit_public
from ..services.fdr import scoped_ids

router = APIRouter(prefix="/audit-events", tags=["audit"])


@router.get("")
def list_events(
    action: str | None = Query(default=None, max_length=64),
    entity_type: str | None = Query(default=None, max_length=40),
    entity_id: str | None = Query(default=None, max_length=36),
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=25, ge=1, le=100),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    stmt = select(AuditEvent)
    if not auth.is_global:
        ids = scoped_ids(db, auth)
        conditions = [
            and_(AuditEvent.entity_type == "USER", AuditEvent.entity_id == auth.user.id),
            # People can always see their own sensitive exports.
            and_(AuditEvent.entity_type == "EXPORT", AuditEvent.actor_id == auth.user.id),
        ]
        if ids:
            conditions.append(
                and_(AuditEvent.entity_type == "FDR", AuditEvent.entity_id.in_(ids))
            )
        stmt = stmt.where(or_(*conditions))
    if action:
        stmt = stmt.where(AuditEvent.action == action.upper())
    if entity_type:
        stmt = stmt.where(AuditEvent.entity_type == entity_type.upper())
    if entity_id:
        stmt = stmt.where(AuditEvent.entity_id == entity_id)

    total = db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar_one()
    rows = (
        db.execute(
            stmt.order_by(AuditEvent.sequence.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )

    fdr_ids = {row.entity_id for row in rows if row.entity_type == "FDR"}
    user_ids = {row.entity_id for row in rows if row.entity_type == "USER"}
    inst_ids = {row.entity_id for row in rows if row.entity_type == "INSTITUTION"}
    labels: dict[str, str] = {}
    if fdr_ids:
        labels.update(
            {
                fdr.id: fdr.reference_number
                for fdr in db.execute(select(FdrRecord).where(FdrRecord.id.in_(fdr_ids))).scalars()
            }
        )
    if user_ids:
        labels.update(
            {
                user.id: user.email
                for user in db.execute(select(User).where(User.id.in_(user_ids))).scalars()
            }
        )
    if inst_ids:
        labels.update(
            {
                inst.id: inst.name
                for inst in db.execute(
                    select(Institution).where(Institution.id.in_(inst_ids))
                ).scalars()
            }
        )

    return {
        "items": [audit_public(row, labels.get(row.entity_id)) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, math.ceil(total / page_size)) if total else 0,
    }
