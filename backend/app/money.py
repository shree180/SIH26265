"""Exact money and date parsing helpers (no floating point for amounts)."""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from .errors import validation_error

MAX_AMOUNT_PAISE = 10**14  # ₹1 trillion, a sane ceiling for a security deposit

_CURRENCY_NOISE = re.compile(r"(?i)\b(inr|rs\.?|rupees?|only)\b|[₹,\s]")
_NUMBER = re.compile(r"\d+(?:\.\d{1,2})?")

_DATE_FORMATS = (
    "%Y-%m-%d",
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%d.%m.%Y",
    "%d %B %Y",
    "%d %b %Y",
    "%B %d, %Y",
    "%b %d, %Y",
)


def paise_to_decimal_string(paise: int) -> str:
    sign = "-" if paise < 0 else ""
    paise = abs(paise)
    return f"{sign}{paise // 100}.{paise % 100:02d}"


def decimal_to_paise(value: Decimal) -> int:
    quantized = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(quantized * 100)


def validate_amount(value: Decimal) -> int:
    if value <= 0:
        raise validation_error("Amount must be greater than zero.", [{"field": "amount", "message": "Enter an amount greater than zero."}])
    paise = decimal_to_paise(value)
    if paise > MAX_AMOUNT_PAISE:
        raise validation_error("Amount is too large.", [{"field": "amount", "message": "Amount exceeds the supported limit."}])
    return paise


def parse_extracted_amount(text: str | None) -> int | None:
    if not text:
        return None
    cleaned = _CURRENCY_NOISE.sub("", text)
    match = _NUMBER.search(cleaned)
    if not match:
        return None
    try:
        return decimal_to_paise(Decimal(match.group(0)))
    except (InvalidOperation, ValueError):
        return None


def parse_extracted_date(text: str | None) -> date | None:
    if not text:
        return None
    candidate = re.sub(r"(?i)\b(issued|on|dated)\b", "", text)
    candidate = re.sub(r"\s+", " ", candidate).strip(" ,.;")
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(candidate, fmt).date()
        except ValueError:
            continue
    # Fall back to the first date-looking token in the line.
    token = re.search(r"\d{1,4}[./-]\d{1,2}[./-]\d{1,4}", candidate)
    if token:
        for fmt in _DATE_FORMATS[:4]:
            try:
                return datetime.strptime(token.group(0), fmt).date()
            except ValueError:
                continue
    return None


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()
