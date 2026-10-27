"""Filter-aware CSV export."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..deps import AuthContext, get_auth, get_db
from ..domain import business_today
from ..services import reports as report_service
from ..services.fdr import FdrListParams
from .common import fdr_list_params

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/fdrs.csv")
def export_fdrs(
    params: FdrListParams = Depends(fdr_list_params),
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
):
    content, count, truncated = report_service.export_fdrs_csv(db, auth, params, auth.settings)
    today = business_today(auth.settings.business_timezone)
    headers = {
        "Content-Disposition": f'attachment; filename="fdr-records-{today.isoformat()}.csv"',
        "Cache-Control": "private, no-store",
        "X-Exported-Rows": str(count),
        "X-Export-Truncated": "true" if truncated else "false",
    }
    return Response(content=content, media_type="text/csv; charset=utf-8", headers=headers)
