"""Sign-in, session rotation, and revocation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..audit import record_audit
from ..config import Settings
from ..errors import ApiError
from ..models import User, UserSession, utcnow
from ..security import (
    LoginThrottle,
    create_access_token,
    hash_password,
    new_csrf_token,
    new_opaque_token,
    password_hash_needs_upgrade,
    token_digest,
    verify_password,
)

_DUMMY_HASH = hash_password("timing-equalisation-only")


@dataclass
class AuthResult:
    user: User
    access_token: str
    access_expires_at: str
    refresh_token: str
    csrf_token: str


def _new_session(user: User, settings: Settings, ip: str | None, user_agent: str | None):
    refresh_token = new_opaque_token()
    csrf_token = new_csrf_token()
    session = UserSession(
        user_id=user.id,
        refresh_token_hash=token_digest(refresh_token),
        csrf_token_hash=token_digest(csrf_token),
        expires_at=utcnow() + timedelta(hours=settings.refresh_token_hours),
        ip_address=(ip or "")[:64] or None,
        user_agent=(user_agent or "")[:255] or None,
        last_used_at=utcnow(),
    )
    return session, refresh_token, csrf_token


def _result(user: User, session: UserSession, settings: Settings, refresh: str, csrf: str) -> AuthResult:
    access, expires = create_access_token(user.id, session.id, user.role, settings)
    return AuthResult(
        user=user,
        access_token=access,
        access_expires_at=expires.isoformat(),
        refresh_token=refresh,
        csrf_token=csrf,
    )


def login(
    db: Session,
    settings: Settings,
    throttle: LoginThrottle,
    *,
    email: str,
    password: str,
    ip: str | None,
    user_agent: str | None,
) -> AuthResult:
    email_norm = email.strip().lower()
    key = f"{ip or 'unknown'}:{email_norm}"
    throttle.check(key)

    user = db.execute(
        select(User).where(func.lower(User.email) == email_norm)
    ).scalar_one_or_none()

    if user is None:
        # Equalise timing so missing accounts are not trivially enumerable.
        verify_password(_DUMMY_HASH, password)
        throttle.register_failure(key)
        raise ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.")

    if user.locked_until and user.locked_until > utcnow():
        raise ApiError(
            429,
            "ACCOUNT_LOCKED",
            "Too many sign-in attempts. Try again later.",
        )

    if not verify_password(user.password_hash, password):
        user.failed_login_count += 1
        if user.failed_login_count >= settings.login_max_attempts:
            user.locked_until = utcnow() + timedelta(minutes=settings.login_lockout_minutes)
            user.failed_login_count = 0
        db.commit()
        throttle.register_failure(key)
        raise ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.")

    if not user.is_active:
        raise ApiError(
            401,
            "ACCOUNT_UNAVAILABLE",
            "This account is not available. Contact an administrator.",
        )

    if password_hash_needs_upgrade(user.password_hash):
        user.password_hash = hash_password(password)

    session, refresh_token, csrf_token = _new_session(user, settings, ip, user_agent)
    db.add(session)
    db.flush()

    user.last_login_at = utcnow()
    user.failed_login_count = 0
    user.locked_until = None
    record_audit(
        db,
        actor=user,
        entity_type="USER",
        entity_id=user.id,
        action="USER_SIGNED_IN",
        payload={"session_id": session.id},
    )
    db.commit()
    db.refresh(user)
    throttle.reset(key)
    return _result(user, session, settings, refresh_token, csrf_token)


def rotate_session(
    db: Session,
    settings: Settings,
    *,
    refresh_token: str | None,
    ip: str | None,
    user_agent: str | None,
) -> AuthResult:
    if not refresh_token:
        raise ApiError(401, "SESSION_EXPIRED", "Your session has expired. Sign in again to continue.")

    session = db.execute(
        select(UserSession).where(
            UserSession.refresh_token_hash == token_digest(refresh_token)
        )
    ).scalar_one_or_none()

    if session is None or session.revoked_at is not None or session.expires_at <= utcnow():
        raise ApiError(401, "SESSION_EXPIRED", "Your session has expired. Sign in again to continue.")

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        raise ApiError(401, "ACCOUNT_UNAVAILABLE", "This account is not available.")

    new_refresh = new_opaque_token()
    new_csrf = new_csrf_token()
    session.refresh_token_hash = token_digest(new_refresh)
    session.csrf_token_hash = token_digest(new_csrf)
    session.last_used_at = utcnow()
    session.expires_at = utcnow() + timedelta(hours=settings.refresh_token_hours)
    session.ip_address = (ip or session.ip_address or "")[:64] or None
    session.user_agent = (user_agent or session.user_agent or "")[:255] or None
    db.commit()
    return _result(user, session, settings, new_refresh, new_csrf)


def revoke_session(db: Session, *, refresh_token: str | None, user: User | None = None) -> None:
    if not refresh_token:
        return
    session = db.execute(
        select(UserSession).where(
            UserSession.refresh_token_hash == token_digest(refresh_token)
        )
    ).scalar_one_or_none()
    if session is None or session.revoked_at is not None:
        return
    session.revoked_at = utcnow()
    actor = user or db.get(User, session.user_id)
    record_audit(
        db,
        actor=actor,
        entity_type="USER",
        entity_id=session.user_id,
        action="USER_SIGNED_OUT",
        payload={"session_id": session.id},
    )
    db.commit()
