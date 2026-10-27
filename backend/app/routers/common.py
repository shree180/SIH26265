"""Shared query-parameter parsing."""

from __future__ import annotations

from fastapi import Query

from ..services.fdr import FdrListParams

ALLOWED_SORTS = {
    "maturity_asc",
    "maturity_desc",
    "amount_desc",
    "created_desc",
    "status",
    "priority_desc",
}


def fdr_list_params(
    search: str | None = Query(default=None, max_length=120),
    status: str | None = Query(default=None, description="Comma-separated lifecycle states."),
    verification_status: str | None = Query(default=None),
    institution_id: str | None = Query(default=None),
    maturity: str | None = Query(default=None, pattern="^(overdue|7|15|30|90|upcoming)$"),
    priority_min: int | None = Query(default=None, ge=0, le=100),
    discrepancy: str | None = Query(default=None, pattern="^(with|without)$"),
    sort: str = Query(default="maturity_asc"),
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=20, ge=1, le=100),
) -> FdrListParams:
    statuses = [value.strip().upper() for value in (status or "").split(",") if value.strip()]
    return FdrListParams(
        search=search,
        statuses=statuses,
        verification_status=verification_status,
        institution_id=institution_id,
        maturity=maturity,
        priority_min=priority_min,
        discrepancy=discrepancy,
        sort=sort if sort in ALLOWED_SORTS else "maturity_asc",
        page=page,
        page_size=page_size,
    )
