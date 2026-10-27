"""Batch metrics used by list/detail serializers and the priority engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..config import Settings
from ..domain import (
    LifecycleStatus,
    PriorityResult,
    compute_priority,
)
from ..models import FdrDocument, FdrRecord, Institution, ReleaseRequest, utcnow
from .extraction import compute_discrepancies, unresolved_discrepancies


@dataclass
class FdrMetrics:
    has_documents: bool = False
    document_count: int = 0
    discrepancy_count: int = 0
    unresolved_discrepancies: int = 0
    discrepancies: list[dict] = field(default_factory=list)
    approval_overdue: bool = False
    review_overdue: bool = False
    pending_release: ReleaseRequest | None = None
    latest_release: ReleaseRequest | None = None


def collect_metrics(
    db: Session,
    fdrs: list[FdrRecord],
    *,
    settings: Settings,
    now: datetime | None = None,
) -> dict[str, FdrMetrics]:
    if not fdrs:
        return {}
    now = now or utcnow()
    ids = [fdr.id for fdr in fdrs]
    institution_ids = {fdr.institution_id for fdr in fdrs}

    institutions = {
        inst.id: inst
        for inst in db.execute(
            select(Institution).where(Institution.id.in_(institution_ids))
        ).scalars()
    }
    documents = (
        db.execute(
            select(FdrDocument)
            .where(FdrDocument.fdr_id.in_(ids))
            .options(selectinload(FdrDocument.extractions))
            .order_by(FdrDocument.uploaded_at.asc())
        )
        .scalars()
        .all()
    )
    docs_by_fdr: dict[str, list[FdrDocument]] = {}
    for document in documents:
        docs_by_fdr.setdefault(document.fdr_id, []).append(document)

    releases = (
        db.execute(
            select(ReleaseRequest)
            .where(ReleaseRequest.fdr_id.in_(ids))
            .order_by(ReleaseRequest.requested_at.desc())
        )
        .scalars()
        .all()
    )
    releases_by_fdr: dict[str, list[ReleaseRequest]] = {}
    for release in releases:
        releases_by_fdr.setdefault(release.fdr_id, []).append(release)

    approval_limit = now - timedelta(hours=settings.approval_sla_hours)
    review_limit = now - timedelta(hours=settings.review_sla_hours)

    metrics: dict[str, FdrMetrics] = {}
    for fdr in fdrs:
        docs = docs_by_fdr.get(fdr.id, [])
        institution = institutions.get(fdr.institution_id)
        discrepancies = (
            compute_discrepancies(fdr, institution.name if institution else "", docs)
            if docs
            else []
        )
        fdr_releases = releases_by_fdr.get(fdr.id, [])
        pending = next(
            (r for r in fdr_releases if r.status == "PENDING_CHECKER"), None
        )
        metrics[fdr.id] = FdrMetrics(
            has_documents=bool(docs),
            document_count=len(docs),
            discrepancy_count=sum(
                1
                for item in discrepancies
                if item["status"] in {"MISMATCH", "REVIEWED_OVERRIDE", "LOW_CONFIDENCE"}
            ),
            unresolved_discrepancies=unresolved_discrepancies(discrepancies),
            discrepancies=discrepancies,
            approval_overdue=bool(pending and pending.requested_at < approval_limit),
            review_overdue=(
                fdr.lifecycle_status == LifecycleStatus.UNDER_REVIEW.value
                and fdr.updated_at < review_limit
            ),
            pending_release=pending,
            latest_release=fdr_releases[0] if fdr_releases else None,
        )
    return metrics


def priority_for(
    fdr: FdrRecord,
    metrics: FdrMetrics,
    *,
    settings: Settings,
    today,
) -> PriorityResult:
    return compute_priority(
        lifecycle_status=fdr.lifecycle_status,
        maturity_date=fdr.maturity_date,
        today=today,
        has_documents=metrics.has_documents,
        unresolved_discrepancies=metrics.unresolved_discrepancies,
        review_overdue=metrics.review_overdue,
        approval_overdue=metrics.approval_overdue,
        thresholds=settings.thresholds,
    )
