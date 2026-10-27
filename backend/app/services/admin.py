"""User and institution administration with audited, guarded changes."""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..audit import record_audit
from ..deps import AuthContext
from ..domain import GLOBAL_ROLES, Role
from ..errors import conflict, forbidden, not_found, validation_error
from ..models import Institution, User, UserSession, utcnow


def list_users(
    db: Session, *, search: str | None, page: int, page_size: int
) -> tuple[list[User], int]:
    stmt = select(User)
    if search:
        like = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(func.lower(User.name).like(like), func.lower(User.email).like(like))
        )
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = (
        db.execute(
            stmt.order_by(User.created_at.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        .scalars()
        .all()
    )
    return list(rows), total


def update_user(db: Session, auth: AuthContext, user_id: str, payload: dict) -> User:
    if auth.user.role != Role.SYSTEM_ADMIN.value:
        raise forbidden("Only a system administrator can manage users.")
    target = db.get(User, user_id)
    if target is None:
        raise not_found("User")

    new_role = payload.get("role") or target.role
    new_active = target.is_active if payload.get("is_active") is None else payload["is_active"]
    new_institution_id = (
        payload["institution_id"] if "institution_id" in payload else target.institution_id
    )

    if target.id == auth.user.id and (
        new_role != target.role or new_active is False
    ):
        raise conflict(
            "You cannot change your own role or deactivate your own account.",
            code="SELF_ADMIN_CHANGE_BLOCKED",
        )

    if target.role == Role.SYSTEM_ADMIN.value and (
        new_role != Role.SYSTEM_ADMIN.value or new_active is False
    ):
        remaining = db.execute(
            select(func.count(User.id)).where(
                User.role == Role.SYSTEM_ADMIN.value,
                User.is_active.is_(True),
                User.id != target.id,
            )
        ).scalar_one()
        if remaining == 0:
            raise conflict(
                "At least one active system administrator must remain.",
                code="LAST_ADMIN",
            )

    if new_role in {Role.INSTITUTION_ADMIN.value}:
        if not new_institution_id:
            raise validation_error(
                "Institution administrators must be linked to an institution.",
                [{"field": "institution_id", "message": "Choose an institution."}],
            )
        institution = db.get(Institution, new_institution_id)
        if institution is None:
            raise validation_error(
                "The selected institution does not exist.",
                [{"field": "institution_id", "message": "Choose an existing institution."}],
            )
    elif new_role in GLOBAL_ROLES:
        # Global review/audit roles are not institution-scoped.
        new_institution_id = None if payload.get("role") else new_institution_id
        if payload.get("role"):
            new_institution_id = None

    changes = {}
    if new_role != target.role:
        changes["role"] = {"from": target.role, "to": new_role}
        target.role = new_role
    if new_active != target.is_active:
        changes["is_active"] = {"from": target.is_active, "to": new_active}
        target.is_active = new_active
    if new_institution_id != target.institution_id:
        changes["institution_id"] = {
            "from": target.institution_id,
            "to": new_institution_id,
        }
        target.institution_id = new_institution_id

    if not changes:
        return target

    if changes.get("is_active", {}).get("to") is False or "role" in changes:
        db.execute(
            UserSession.__table__.update()
            .where(UserSession.user_id == target.id, UserSession.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )

    record_audit(
        db,
        actor=auth.user,
        entity_type="USER",
        entity_id=target.id,
        action="USER_UPDATED",
        payload={"target_email": target.email, "changes": changes},
    )
    db.commit()
    db.refresh(target)
    return target


def create_institution(
    db: Session, auth: AuthContext, *, code: str, name: str, contact_email: str
) -> Institution:
    if auth.user.role != Role.SYSTEM_ADMIN.value:
        raise forbidden("Only a system administrator can add institutions.")
    existing = db.execute(
        select(Institution.id).where(Institution.institution_code == code)
    ).first()
    if existing:
        raise conflict("An institution with this code already exists.", code="DUPLICATE_INSTITUTION")
    institution = Institution(
        institution_code=code, name=name, contact_email=contact_email, status="ACTIVE"
    )
    db.add(institution)
    db.flush()
    record_audit(
        db,
        actor=auth.user,
        entity_type="INSTITUTION",
        entity_id=institution.id,
        action="INSTITUTION_CREATED",
        payload={"institution_code": code, "name": name},
    )
    db.commit()
    db.refresh(institution)
    return institution


def update_institution(db: Session, auth: AuthContext, institution_id: str, changes: dict) -> Institution:
    if auth.user.role != Role.SYSTEM_ADMIN.value:
        raise forbidden("Only a system administrator can change institutions.")
    institution = db.get(Institution, institution_id)
    if institution is None:
        raise not_found("Institution")
    applied = {}
    for field_name in ("name", "contact_email", "status"):
        if field_name in changes and changes[field_name] is not None:
            new_value = changes[field_name]
            if getattr(institution, field_name) != new_value:
                applied[field_name] = {"from": getattr(institution, field_name), "to": new_value}
                setattr(institution, field_name, new_value)
    if applied:
        record_audit(
            db,
            actor=auth.user,
            entity_type="INSTITUTION",
            entity_id=institution.id,
            action="INSTITUTION_UPDATED",
            payload={"changes": applied},
        )
        db.commit()
    db.refresh(institution)
    return institution
