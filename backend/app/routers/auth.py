"""Authentication endpoints using HttpOnly cookies plus a CSRF header."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import AuthContext, get_auth, get_db
from ..domain import Role
from ..errors import ApiError
from ..models import Notification, User
from ..schemas import LoginRequest
from ..security import (
    ACCESS_COOKIE,
    CSRF_COOKIE,
    CSRF_HEADER,
    REFRESH_COOKIE,
    constant_time_equals,
)
from ..serializers import user_public
from ..services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
me_router = APIRouter(tags=["auth"])

REFRESH_PATH = "/api/v1/auth"


def _client(request: Request) -> tuple[str | None, str | None]:
    ip = request.client.host if request.client else None
    return ip, request.headers.get("user-agent")


def _set_cookies(response: Response, settings: Settings, result: auth_service.AuthResult) -> None:
    common = {"httponly": True, "samesite": "lax", "secure": settings.cookie_secure}
    response.set_cookie(
        ACCESS_COOKIE,
        result.access_token,
        max_age=settings.access_token_minutes * 60,
        path="/",
        **common,
    )
    response.set_cookie(
        REFRESH_COOKIE,
        result.refresh_token,
        max_age=settings.refresh_token_hours * 3600,
        path=REFRESH_PATH,
        **common,
    )
    response.set_cookie(
        CSRF_COOKIE,
        result.csrf_token,
        max_age=settings.refresh_token_hours * 3600,
        path="/",
        httponly=False,
        samesite="lax",
        secure=settings.cookie_secure,
    )


def _clear_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_PATH)


def _check_csrf(request: Request) -> None:
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    if not cookie or not header or not constant_time_equals(cookie, header):
        raise ApiError(
            403,
            "CSRF_FAILED",
            "Your request could not be verified. Refresh the page and try again.",
        )


@router.post("/login")
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    settings: Settings = request.app.state.settings
    ip, user_agent = _client(request)
    result = auth_service.login(
        db,
        settings,
        request.app.state.login_throttle,
        email=payload.email,
        password=payload.password,
        ip=ip,
        user_agent=user_agent,
    )
    _set_cookies(response, settings, result)
    response.headers["Cache-Control"] = "no-store"
    return {
        "user": user_public(result.user),
        "csrf_token": result.csrf_token,
        "access_expires_at": result.access_expires_at,
    }


@router.post("/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    _check_csrf(request)
    settings: Settings = request.app.state.settings
    ip, user_agent = _client(request)
    result = auth_service.rotate_session(
        db,
        settings,
        refresh_token=request.cookies.get(REFRESH_COOKIE),
        ip=ip,
        user_agent=user_agent,
    )
    _set_cookies(response, settings, result)
    response.headers["Cache-Control"] = "no-store"
    return {
        "user": user_public(result.user),
        "csrf_token": result.csrf_token,
        "access_expires_at": result.access_expires_at,
    }


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    _check_csrf(request)
    auth_service.revoke_session(db, refresh_token=request.cookies.get(REFRESH_COOKIE))
    _clear_cookies(response)
    response.headers["Cache-Control"] = "no-store"
    return {"signed_out": True}


@me_router.get("/me")
def me(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)):
    unread = db.execute(
        select(Notification.id).where(
            Notification.recipient_id == auth.user.id, Notification.acknowledged_at.is_(None)
        )
    ).all()
    role = auth.user.role
    return {
        "user": user_public(auth.user),
        "unread_notifications": len(unread),
        "capabilities": {
            "can_manage_users": role == Role.SYSTEM_ADMIN.value,
            "can_review": role == Role.REVIEWING_OFFICER.value,
            "can_decide_release": role == Role.APPROVING_OFFICER.value,
            "can_submit": role == Role.INSTITUTION_ADMIN.value,
            "read_only": role == Role.AUDITOR.value,
        },
    }
