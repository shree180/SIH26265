"""Public, non-sensitive runtime description for the UI."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..domain import STATUS_LABELS, LifecycleStatus, Role

router = APIRouter(tags=["meta"])

ROLE_LABELS = {
    Role.INSTITUTION_ADMIN.value: "Institution Administrator",
    Role.REVIEWING_OFFICER.value: "Reviewing Officer",
    Role.APPROVING_OFFICER.value: "Approving Officer",
    Role.AUDITOR.value: "Auditor",
    Role.SYSTEM_ADMIN.value: "System Administrator",
}


@router.get("/meta")
def meta(request: Request):
    settings = request.app.state.settings
    return {
        "app_name": settings.app_name,
        "environment": settings.app_env,
        "business_timezone": settings.business_timezone,
        "maturity_thresholds": settings.thresholds,
        "lifecycle_statuses": [
            {"value": status.value, "label": STATUS_LABELS.get(status.value, status.value)}
            for status in LifecycleStatus
        ],
        "roles": [{"value": value, "label": label} for value, label in ROLE_LABELS.items()],
        "verification": {
            "mode": settings.bank_verification_mode,
            "simulated": settings.bank_verification_mode == "simulated",
            "label": (
                "Simulated verification — not a bank confirmation"
                if settings.bank_verification_mode == "simulated"
                else "Manual verification only"
            ),
        },
        "extraction": {
            "pdf_text_layer": True,
            "image_ocr": False,
            "label": "PDF text extraction; image OCR unavailable in this environment",
        },
        "alert_policy": (
            "One alert per maturity threshold per FDR per recipient. Acknowledging an "
            "alert does not complete the underlying action."
        ),
        "export_row_cap": 5000,
        "disclaimer": (
            "Prototype with synthetic data. This system does not prove FDR authenticity "
            "and does not move funds."
        ),
    }
