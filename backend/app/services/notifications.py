"""Maturity monitoring with deterministic, deduplicated in-app alerts."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..audit import record_audit
from ..config import Settings
from ..deps import AuthContext
from ..domain import LifecycleStatus, business_today
from ..errors import not_found
from ..models import FdrRecord, Notification, User, utcnow
from .fdr import apply_transition

ALERT_POLICY_VERSION = "v1"
MONITORED_STATES = {
    LifecycleStatus.VERIFIED.value,
    LifecycleStatus.ACTIVE.value,
    LifecycleStatus.MATURING.value,
    LifecycleStatus.RENEWAL_PENDING.value,
    LifecycleStatus.PENDING_CHECKER.value,
    LifecycleStatus.RELEASE_REQUESTED.value,
}


def threshold_bucket(days_remaining: int, thresholds: list[int]) -> int | None:
    if days_remaining < 0:
        return None
    for threshold in sorted(thresholds):
        if days_remaining <= threshold:
            return threshold
    return None


def _dedupe_key(fdr_id: str, threshold: int | None, recipient_id: str) -> str:
    bucket = str(threshold) if threshold is not None else "OVERDUE"
    return f"{fdr_id}:MATURITY:{bucket}:{ALERT_POLICY_VERSION}:{recipient_id}"


def run_maturity_scan(
    db: Session,
    settings: Settings,
    *,
    actor: User | None = None,
    now: datetime | None = None,
) -> dict:
    """Scan current state, so a missed run is recoverable. Safe to repeat."""
    now = now or utcnow()
    today = business_today(settings.business_timezone)
    thresholds = settings.thresholds
    max_threshold = max(thresholds)

    fdrs = (
        db.execute(
            select(FdrRecord).where(FdrRecord.lifecycle_status.in_(MONITORED_STATES))
        )
        .scalars()
        .all()
    )

    created = 0
    existing = 0
    transitions = 0
    expired = 0
    skipped_no_recipient = 0

    for fdr in fdrs:
        days = (fdr.maturity_date - today).days

        if fdr.lifecycle_status == LifecycleStatus.ACTIVE.value and 0 <= days <= max_threshold:
            apply_transition(
                db,
                None,
                fdr,
                action="MARK_MATURING",
                reason=f"Maturity in {days} day(s).",
                system=True,
            )
            transitions += 1

        if (
            fdr.lifecycle_status
            in {
                LifecycleStatus.ACTIVE.value,
                LifecycleStatus.MATURING.value,
                LifecycleStatus.VERIFIED.value,
            }
            and days < -settings.expiry_grace_days
        ):
            apply_transition(
                db,
                None,
                fdr,
                action="MARK_EXPIRED",
                reason=(
                    f"Maturity passed {abs(days)} day(s) ago with no recorded resolution "
                    f"(grace period {settings.expiry_grace_days} days)."
                ),
                system=True,
            )
            transitions += 1
            expired += 1
            continue

        threshold = threshold_bucket(days, thresholds)
        if days >= 0 and threshold is None:
            continue
        if days < 0:
            alert_type = "MATURITY_OVERDUE"
            threshold_value = None
        else:
            alert_type = f"MATURITY_{threshold}"
            threshold_value = threshold

        recipients = (
            db.execute(
                select(User).where(
                    User.institution_id == fdr.institution_id,
                    User.role == "INSTITUTION_ADMIN",
                    User.is_active.is_(True),
                )
            )
            .scalars()
            .all()
        )
        if not recipients:
            skipped_no_recipient += 1
            continue

        for recipient in recipients:
            key = _dedupe_key(fdr.id, threshold_value, recipient.id)
            already = db.execute(
                select(Notification.id).where(Notification.dedupe_key == key).limit(1)
            ).first()
            if already:
                existing += 1
                continue
            db.add(
                Notification(
                    fdr_id=fdr.id,
                    recipient_id=recipient.id,
                    alert_type=alert_type,
                    threshold_days=threshold_value,
                    dedupe_key=key,
                    channel="IN_APP",
                    status="DELIVERED",
                    scheduled_at=now,
                    sent_at=now,
                )
            )
            created += 1

    record_audit(
        db,
        actor=actor,
        entity_type="SYSTEM",
        entity_id="maturity_scan",
        action="MATURITY_SCAN_RUN",
        payload={
            "scanned": len(fdrs),
            "alerts_created": created,
            "alerts_existing": existing,
            "transitions": transitions,
            "expired": expired,
            "skipped_no_recipient": skipped_no_recipient,
            "policy_version": ALERT_POLICY_VERSION,
        },
    )
    db.commit()
    return {
        "scanned": len(fdrs),
        "alerts_created": created,
        "alerts_existing": existing,
        "transitions": transitions,
        "expired": expired,
        "skipped_no_recipient": skipped_no_recipient,
        "policy_version": ALERT_POLICY_VERSION,
        "run_at": now.isoformat() + "Z",
    }


def list_notifications(
    db: Session, auth: AuthContext, *, unread_only: bool = False, limit: int = 50
) -> list[tuple[Notification, FdrRecord]]:
    stmt = select(Notification).where(Notification.recipient_id == auth.user.id)
    if unread_only:
        stmt = stmt.where(Notification.acknowledged_at.is_(None))
    notifications = (
        db.execute(stmt.order_by(Notification.created_at.desc()).limit(min(limit, 100)))
        .scalars()
        .all()
    )
    result = []
    for notification in notifications:
        fdr = db.get(FdrRecord, notification.fdr_id)
        if fdr is not None:
            result.append((notification, fdr))
    return result


def acknowledge(db: Session, auth: AuthContext, notification_id: str) -> Notification:
    notification = db.get(Notification, notification_id)
    if notification is None or notification.recipient_id != auth.user.id:
        raise not_found("Notification")
    if notification.acknowledged_at is None:
        notification.acknowledged_at = utcnow()
        record_audit(
            db,
            actor=auth.user,
            entity_type="FDR",
            entity_id=notification.fdr_id,
            action="ALERT_ACKNOWLEDGED",
            payload={"notification_id": notification.id, "alert_type": notification.alert_type},
        )
        db.commit()
    return notification


def unread_count(db: Session, auth: AuthContext) -> int:
    from sqlalchemy import func

    return (
        db.execute(
            select(func.count(Notification.id)).where(
                Notification.recipient_id == auth.user.id,
                Notification.acknowledged_at.is_(None),
            )
        ).scalar_one()
    )
