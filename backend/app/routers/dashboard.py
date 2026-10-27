"""Role-scoped dashboard summary."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..deps import AuthContext, get_auth, get_db
from ..services import dashboard as dashboard_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    response = dashboard_service.summary(db, auth, auth.settings)
    response["limits"] = {
        "note": (
            "Priority-ordered aggregates are computed over at most 5,000 scoped records "
            "for this prototype."
        )
    }
    return response
