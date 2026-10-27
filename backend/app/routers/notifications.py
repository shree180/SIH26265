"""In-app maturity notifications for the signed-in recipient."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..deps import AuthContext, get_auth, get_db
from ..models import FdrRecord
from ..serializers import notification_public
from ..services import notifications as notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=100),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    rows = notification_service.list_notifications(
        db, auth, unread_only=unread_only, limit=limit
    )
    return {
        "items": [notification_public(item, fdr) for item, fdr in rows],
        "unread_count": notification_service.unread_count(db, auth),
    }


@router.post("/{notification_id}/acknowledge")
def acknowledge(
    notification_id: str,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    notification = notification_service.acknowledge(db, auth, notification_id)
    fdr = db.get(FdrRecord, notification.fdr_id)
    return notification_public(notification, fdr)
