"""Request dependencies: database session, authentication, CSRF, authorization."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from .config import Settings
from .domain import GLOBAL_ROLES, Role
from .errors import ApiError, forbidden, not_found
from .models import FdrRecord, User, UserSession, utcnow
from .security import (
    ACCESS_COOKIE,
    CSRF_COOKIE,
    CSRF_HEADER,
    constant_time_equals,
    decode_access_token,
    token_digest,
)

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_db(request: Request) -> Iterator[Session]:
    session = request.app.state.SessionLocal()
    try:
        yield session
    finally:
        session.close()


@dataclass
class AuthContext:
    user: User
    session: UserSession
    settings: Settings

    @property
    def role(self) -> str:
        return self.user.role

    @property
    def is_global(self) -> bool:
        return self.user.role in GLOBAL_ROLES


def _extract_access_token(request: Request) -> str | None:
    header = request.headers.get("Authorization")
    if header and header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.cookies.get(ACCESS_COOKIE)


def get_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    token = _extract_access_token(request)
    if not token:
        raise ApiError(401, "NOT_AUTHENTICATED", "Sign in to continue.")
    settings: Settings = request.app.state.settings
    claims = decode_access_token(token, settings)

    user = db.get(User, claims.get("sub"))
    if user is None or not user.is_active:
        raise ApiError(401, "ACCOUNT_UNAVAILABLE", "This account is not available. Contact an administrator.")

    session = db.get(UserSession, claims.get("sid"))
    if session is None or session.user_id != user.id or session.revoked_at is not None:
        raise ApiError(401, "SESSION_REVOKED", "Your session is no longer valid. Sign in again to continue.")
    if session.expires_at <= utcnow():
        raise ApiError(401, "SESSION_EXPIRED", "Your session has expired. Sign in again to continue.")

    if request.method.upper() not in SAFE_METHODS:
        header_token = request.headers.get(CSRF_HEADER)
        cookie_token = request.cookies.get(CSRF_COOKIE)
        if (
            not header_token
            or not cookie_token
            or not constant_time_equals(header_token, cookie_token)
            or not constant_time_equals(token_digest(header_token), session.csrf_token_hash)
        ):
            raise ApiError(
                403,
                "CSRF_FAILED",
                "Your request could not be verified. Refresh the page and try again.",
            )

    return AuthContext(user=user, session=session, settings=settings)


def current_user(auth: AuthContext = Depends(get_auth)) -> User:
    return auth.user


def require_roles(*roles: str):
    allowed = set(roles)

    def dependency(auth: AuthContext = Depends(get_auth)) -> AuthContext:
        if auth.user.role not in allowed:
            raise forbidden()
        return auth

    return dependency


def assert_fdr_read(auth: AuthContext, fdr: FdrRecord) -> None:
    if auth.is_global:
        return
    if auth.user.institution_id != fdr.institution_id:
        # Deliberately 404 so record existence is not disclosed across tenants.
        raise not_found("FDR record")


def assert_institution_owner(auth: AuthContext, fdr: FdrRecord) -> None:
    if auth.user.role != Role.INSTITUTION_ADMIN.value:
        raise forbidden("Only an institution administrator can change this submission.")
    if auth.user.institution_id != fdr.institution_id:
        raise not_found("FDR record")


def assert_read_only_role_allowed(auth: AuthContext) -> None:
    if auth.user.role == Role.AUDITOR.value:
        raise forbidden("Auditors have read-only access.")
