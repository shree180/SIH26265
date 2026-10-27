"""CSV export that respects scope, filters and spreadsheet-formula safety."""

from __future__ import annotations

import csv
import io

from sqlalchemy.orm import Session

from ..audit import record_audit
from ..config import Settings
from ..deps import AuthContext
from .fdr import FdrListParams, search_fdrs

EXPORT_CAP = 5000
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
HEADERS = [
    "Reference",
    "Institution",
    "Institution code",
    "Bank",
    "Bank code",
    "Amount",
    "Currency",
    "Issue date",
    "Maturity date",
    "Days remaining",
    "Lifecycle status",
    "Verification status",
    "Priority score",
    "Priority reasons",
    "Documents",
    "Unresolved discrepancies",
    "Created at",
]


def _safe_cell(value) -> str:
    text = "" if value is None else str(value)
    if text.startswith(FORMULA_PREFIXES):
        # Prefixing with an apostrophe stops spreadsheets treating the value as a formula.
        return "'" + text
    return text


def export_fdrs_csv(
    db: Session, auth: AuthContext, params: FdrListParams, settings: Settings
) -> tuple[str, int, bool]:
    params.page = 1
    params.page_size = EXPORT_CAP
    rows, total, _ = search_fdrs(db, auth, params)

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
    writer.writerow(HEADERS)
    for fdr, metrics, priority in rows:
        writer.writerow(
            [
                _safe_cell(fdr.reference_number),
                _safe_cell(fdr.institution.name if fdr.institution else ""),
                _safe_cell(fdr.institution.institution_code if fdr.institution else ""),
                _safe_cell(fdr.bank_name),
                _safe_cell(fdr.bank_code or ""),
                _safe_cell(f"{fdr.amount_paise // 100}.{fdr.amount_paise % 100:02d}"),
                _safe_cell(fdr.currency),
                _safe_cell(fdr.issue_date.isoformat()),
                _safe_cell(fdr.maturity_date.isoformat()),
                _safe_cell((fdr.maturity_date - params_today(auth)).days),
                _safe_cell(fdr.lifecycle_status),
                _safe_cell(fdr.verification_status),
                _safe_cell(priority.score),
                _safe_cell(priority.summary),
                _safe_cell(metrics.document_count),
                _safe_cell(metrics.unresolved_discrepancies),
                _safe_cell(fdr.created_at.isoformat() + "Z"),
            ]
        )

    record_audit(
        db,
        actor=auth.user,
        entity_type="EXPORT",
        entity_id="fdr_csv",
        action="EXPORT_FDRS",
        payload={
            "row_count": len(rows),
            "truncated": total > len(rows),
            "filters": {
                "search": params.search,
                "statuses": params.statuses,
                "verification_status": params.verification_status,
                "institution_id": params.institution_id,
                "maturity": params.maturity,
                "priority_min": params.priority_min,
                "discrepancy": params.discrepancy,
            },
        },
    )
    db.commit()
    return buffer.getvalue(), len(rows), total > len(rows)


def params_today(auth: AuthContext):
    from ..domain import business_today

    return business_today(auth.settings.business_timezone)
