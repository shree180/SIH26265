"""Password hashing, session tokens, CSRF, and login throttling."""

from __future__ import annotations

import hashlib
import secrets
import threading
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from .config import Settings
from .errors import ApiError

# Argon2id with measured-cost parameters suitable for an interactive login.
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, hash_len=32, salt_len=16)

ACCESS_COOKIE = "fdr_access"
REFRESH_COOKIE = "fdr_refresh"
CSRF_COOKIE = "fdr_csrf"
CSRF_HEADER = "X-CSRF-Token"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def password_hash_needs_upgrade(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def password_problems(password: str) -> list[str]:
    problems: list[str] = []
    if len(password) < 10:
        problems.append("Use at least 10 characters.")
    if not any(c.isalpha() for c in password):
        problems.append("Include at least one letter.")
    if not any(c.isdigit() for c in password):
        problems.append("Include at least one number.")
    return problems


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user_id: str, session_id: str, role: str, settings: Settings) -> tuple[str, datetime]:
    expires_at = _now() + timedelta(minutes=settings.access_token_minutes)
    payload = {
        "sub": user_id,
        "sid": session_id,
        "role": role,
        "typ": "access",
        "iat": int(_now().timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": secrets.token_hex(8),
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    return token, expires_at


def decode_access_token(token: str, settings: Settings) -> dict:
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub", "sid"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise ApiError(401, "SESSION_EXPIRED", "Your session has expired. Sign in again to continue.") from exc
    except jwt.InvalidTokenError as exc:
        raise ApiError(401, "INVALID_SESSION", "Your session is not valid. Sign in again to continue.") from exc
    if claims.get("typ") != "access":
        raise ApiError(401, "INVALID_SESSION", "Your session is not valid. Sign in again to continue.")
    return claims


def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def constant_time_equals(left: str, right: str) -> bool:
    return secrets.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


class LoginThrottle:
    """In-memory login throttle for the single-instance demo.

    A production deployment needs a shared store (Redis) so limits apply across
    workers and instances.
    """

    def __init__(self, max_attempts: int = 5, lockout_minutes: int = 15) -> None:
        self.max_attempts = max_attempts
        self.lockout = timedelta(minutes=lockout_minutes)
        self._lock = threading.Lock()
        self._failures: dict[str, list[datetime]] = {}

    def _prune(self, key: str, now: datetime) -> list[datetime]:
        attempts = [a for a in self._failures.get(key, []) if now - a < self.lockout]
        if attempts:
            self._failures[key] = attempts
        else:
            self._failures.pop(key, None)
        return attempts

    def check(self, key: str) -> None:
        now = _now()
        with self._lock:
            attempts = self._prune(key, now)
            if len(attempts) >= self.max_attempts:
                retry_in = int((self.lockout - (now - attempts[0])).total_seconds() // 60) + 1
                raise ApiError(
                    429,
                    "TOO_MANY_ATTEMPTS",
                    "Too many sign-in attempts. Try again later.",
                    hint=f"Try again in about {retry_in} minute(s).",
                )

    def register_failure(self, key: str) -> None:
        now = _now()
        with self._lock:
            self._failures.setdefault(key, []).append(now)
            self._prune(key, now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
