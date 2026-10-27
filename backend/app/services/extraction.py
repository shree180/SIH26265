"""Document text extraction and submitted-vs-extracted comparison.

Honesty rules implemented here:
* PDF text-layer extraction is real, but it is not OCR and provides no
  confidence score. The engine reports that instead of inventing one.
* Image OCR requires a Tesseract binary that is not installed in this
  environment; the extraction is reported as UNAVAILABLE and manual entry is
  the fallback. It is never simulated as a successful read.
* Extraction output is always a candidate value, stored separately from what
  the institution submitted.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from datetime import date

from ..domain import DiscrepancyStatus, ExtractionStatus
from ..models import FdrDocument, FdrRecord
from ..money import (
    normalize_text,
    paise_to_decimal_string,
    parse_extracted_amount,
    parse_extracted_date,
)

ENGINE_TEXT_LAYER = "pdf-text-layer"
ENGINE_TESSERACT = "tesseract-ocr"
ENGINE_NONE = "not-configured"

LOW_CONFIDENCE_THRESHOLD = 0.6

ALLOWED_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
}

MAGIC_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"%PDF-", "application/pdf"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)

FIELD_LABELS = {
    "reference_number": "FDR reference",
    "bank_name": "Bank name",
    "amount": "Deposit amount",
    "issue_date": "Issue date",
    "maturity_date": "Maturity date",
    "institution_name": "Institution name",
}

FIELD_KINDS = {
    "reference_number": "text",
    "bank_name": "text",
    "amount": "money",
    "issue_date": "date",
    "maturity_date": "date",
    "institution_name": "text",
}

# Fields surfaced in the discrepancy panel. Institution name is compared only
# when the document actually contains it.
COMPARED_FIELDS = (
    "reference_number",
    "bank_name",
    "amount",
    "issue_date",
    "maturity_date",
    "institution_name",
)

PATTERNS: dict[str, list[str]] = {
    "reference_number": [
        r"(?i)\breference(?:\s*(?:no\.?|number))?\s*[:#\-]\s*([A-Za-z0-9][A-Za-z0-9/_.\-]{2,63})",
        r"(?i)\bfdr\s*(?:no\.?|number)\s*[:#\-]\s*([A-Za-z0-9][A-Za-z0-9/_.\-]{2,63})",
    ],
    "bank_name": [
        r"(?im)^\s*bank(?:\s*name)?\s*[:\-]\s*([^\n]{3,120})",
        r"(?i)\bissued\s+by\s*[:\-]\s*([^\n]{3,120})",
    ],
    "amount": [
        r"(?i)\b(?:deposit\s*)?amount\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([0-9][0-9,\s]*(?:\.[0-9]{1,2})?)",
    ],
    "issue_date": [
        r"(?i)\bissue(?:d)?\s*date\s*[:\-]\s*([0-9A-Za-z .,/\-]{6,24})",
    ],
    "maturity_date": [
        r"(?i)\bmaturity(?:\s*date)?\s*[:\-]\s*([0-9A-Za-z .,/\-]{6,24})",
    ],
    "institution_name": [
        r"(?im)^\s*institution(?:\s*name)?\s*[:\-]\s*([^\n]{3,160})",
    ],
}


@dataclass
class ExtractedField:
    value: str | None
    confidence: float | None = None
    page_number: int | None = None


@dataclass
class ExtractionOutcome:
    status: str
    engine: str
    note: str
    fields: dict[str, ExtractedField] = field(default_factory=dict)


def detect_content_type(header: bytes) -> str | None:
    for signature, content_type in MAGIC_SIGNATURES:
        if header.startswith(signature):
            return content_type
    return None


def parse_fields(text: str) -> dict[str, ExtractedField]:
    results: dict[str, ExtractedField] = {}
    for field_name, patterns in PATTERNS.items():
        for pattern in patterns:
            match = re.search(pattern, text)
            if not match:
                continue
            raw = match.group(1).strip()
            raw = re.sub(r"\s+", " ", raw).strip(" .,;:-")
            if not raw:
                continue
            results[field_name] = ExtractedField(value=raw, confidence=None, page_number=1)
            break
    return results


def extract_document(data: bytes, content_type: str) -> ExtractionOutcome:
    if content_type == "application/pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            pages = []
            for page in reader.pages[:5]:
                try:
                    pages.append(page.extract_text() or "")
                except Exception:
                    pages.append("")
            text = "\n".join(pages)
        except Exception:
            return ExtractionOutcome(
                status=ExtractionStatus.FAILED.value,
                engine=ENGINE_TEXT_LAYER,
                note="The PDF could not be read. Enter the document values manually.",
            )
        if len(text.strip()) < 15:
            return ExtractionOutcome(
                status=ExtractionStatus.NO_TEXT_LAYER.value,
                engine=ENGINE_TEXT_LAYER,
                note=(
                    "This PDF has no readable text layer (it may be a scan), and no OCR "
                    "engine is installed here. Enter the document values manually."
                ),
            )
        fields = parse_fields(text)
        if not fields:
            return ExtractionOutcome(
                status=ExtractionStatus.NEEDS_REVIEW.value,
                engine=ENGINE_TEXT_LAYER,
                note=(
                    "Text was extracted but no supported FDR field matched the expected "
                    "layout. Compare manually and record the document values."
                ),
            )
        return ExtractionOutcome(
            status=ExtractionStatus.EXTRACTED.value,
            engine=ENGINE_TEXT_LAYER,
            note=(
                "Values read from the PDF text layer. This is not OCR and the engine "
                "reports no confidence score; review each value before relying on it."
            ),
            fields=fields,
        )

    if content_type in {"image/png", "image/jpeg"}:
        return ExtractionOutcome(
            status=ExtractionStatus.UNAVAILABLE.value,
            engine=ENGINE_NONE,
            note=(
                "No OCR engine is configured in this environment, so image text was not "
                "read. Enter the document values manually and record the review."
            ),
        )

    return ExtractionOutcome(
        status=ExtractionStatus.FAILED.value,
        engine=ENGINE_NONE,
        note="Unsupported document type for extraction.",
    )


def _display_submitted(field_name: str, fdr: FdrRecord, institution_name: str) -> str:
    if field_name == "amount":
        return paise_to_decimal_string(fdr.amount_paise)
    if field_name == "issue_date":
        return fdr.issue_date.isoformat()
    if field_name == "maturity_date":
        return fdr.maturity_date.isoformat()
    if field_name == "reference_number":
        return fdr.reference_number
    if field_name == "bank_name":
        return fdr.bank_name
    return institution_name


def _normalise(field_name: str, value: str | None) -> object:
    if value is None:
        return None
    kind = FIELD_KINDS[field_name]
    if kind == "text":
        return normalize_text(value)
    if kind == "money":
        return parse_extracted_amount(value)
    if kind == "date":
        parsed = parse_extracted_date(value)
        return parsed.isoformat() if parsed else None
    return value


def _submitted_normalised(field_name: str, fdr: FdrRecord, institution_name: str) -> object:
    if field_name == "amount":
        return fdr.amount_paise
    if field_name == "issue_date":
        return fdr.issue_date.isoformat()
    if field_name == "maturity_date":
        return fdr.maturity_date.isoformat()
    if field_name == "reference_number":
        return normalize_text(fdr.reference_number)
    if field_name == "bank_name":
        return normalize_text(fdr.bank_name)
    return normalize_text(institution_name)


def _is_low_confidence(confidence: float | None) -> bool:
    return confidence is not None and confidence < LOW_CONFIDENCE_THRESHOLD


def compute_discrepancies(
    fdr: FdrRecord,
    institution_name: str,
    documents: list[FdrDocument],
) -> list[dict]:
    """Field-level comparison using the most recent extraction of each field."""
    latest: dict[str, tuple[object, FdrDocument]] = {}
    for document in documents:
        for extraction in document.extractions:
            existing = latest.get(extraction.field_name)
            if existing is None or extraction.created_at >= existing[0].created_at:
                latest[extraction.field_name] = (extraction, document)

    results: list[dict] = []
    for field_name in COMPARED_FIELDS:
        label = FIELD_LABELS[field_name]
        submitted_display = _display_submitted(field_name, fdr, institution_name)
        submitted_norm = _submitted_normalised(field_name, fdr, institution_name)
        entry = latest.get(field_name)

        if entry is None:
            if field_name == "institution_name":
                continue
            results.append(
                {
                    "field": field_name,
                    "label": label,
                    "kind": FIELD_KINDS[field_name],
                    "submitted_value": submitted_display,
                    "extracted_value": None,
                    "corrected_value": None,
                    "confidence": None,
                    "status": DiscrepancyStatus.MISSING_IN_DOCUMENT.value,
                    "review_status": None,
                    "resolved": True,
                    "extraction_id": None,
                    "document_id": None,
                    "document_name": None,
                    "note": "No extracted value for this field.",
                }
            )
            continue

        extraction, document = entry
        effective_value = extraction.extracted_value
        if extraction.review_status == "CORRECTED" and extraction.corrected_value:
            effective_value = extraction.corrected_value

        effective_norm = _normalise(field_name, effective_value)
        matches = effective_norm is not None and effective_norm == submitted_norm
        pending = extraction.review_status == "PENDING"

        if extraction.review_status == "DISMISSED":
            status = DiscrepancyStatus.DISMISSED.value
        elif extraction.review_status in {"CONFIRMED", "CORRECTED"}:
            status = (
                DiscrepancyStatus.REVIEWED_MATCH.value
                if matches
                else DiscrepancyStatus.REVIEWED_OVERRIDE.value
            )
        elif effective_value is None or effective_norm is None:
            status = DiscrepancyStatus.MISSING_IN_DOCUMENT.value
        elif not matches:
            status = DiscrepancyStatus.MISMATCH.value
        elif _is_low_confidence(extraction.confidence):
            status = DiscrepancyStatus.LOW_CONFIDENCE.value
        else:
            status = DiscrepancyStatus.MATCH.value

        unresolved = pending and status in {
            DiscrepancyStatus.MISMATCH.value,
            DiscrepancyStatus.LOW_CONFIDENCE.value,
        }

        results.append(
            {
                "field": field_name,
                "label": label,
                "kind": FIELD_KINDS[field_name],
                "submitted_value": submitted_display,
                "extracted_value": extraction.extracted_value,
                "corrected_value": extraction.corrected_value,
                "confidence": extraction.confidence,
                "status": status,
                "review_status": extraction.review_status,
                "resolved": not unresolved,
                "extraction_id": extraction.id,
                "document_id": document.id,
                "document_name": document.original_filename,
                "note": (
                    "Reviewer recorded a corrected document value."
                    if extraction.review_status == "CORRECTED"
                    else "Values differ. Confirm which value is correct."
                    if status == DiscrepancyStatus.MISMATCH.value
                    else "Low extraction confidence. Confirm manually."
                    if status == DiscrepancyStatus.LOW_CONFIDENCE.value
                    else None
                ),
            }
        )
    return results


def unresolved_discrepancies(discrepancies: list[dict]) -> int:
    return sum(1 for item in discrepancies if not item["resolved"])


def discrepancy_summary(discrepancies: list[dict]) -> str | None:
    mismatched = [d["label"] for d in discrepancies if not d["resolved"]]
    if not mismatched:
        return None
    return f"{len(mismatched)} document field(s) need review: {', '.join(mismatched)}."


def parse_date_input(value: str | None) -> date | None:
    return parse_extracted_date(value)
