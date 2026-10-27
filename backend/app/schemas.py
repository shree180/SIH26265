"""Request schemas. Every protected write is validated here and again by the
service layer (state, scope, separation of duties).
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

ISO_DATE_HINT = "Use YYYY-MM-DD."


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class InstitutionCreate(BaseModel):
    institution_code: str = Field(min_length=3, max_length=32)
    name: str = Field(min_length=3, max_length=160)
    contact_email: EmailStr

    @field_validator("institution_code")
    @classmethod
    def _code(cls, value: str) -> str:
        cleaned = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9\-]{3,32}", cleaned):
            raise ValueError("Use 3-32 letters, digits or hyphens.")
        return cleaned


class InstitutionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=160)
    contact_email: EmailStr | None = None
    status: Literal["ACTIVE", "INACTIVE"] | None = None


class FdrFields(BaseModel):
    reference_number: str = Field(min_length=3, max_length=64)
    bank_name: str = Field(min_length=2, max_length=160)
    bank_code: str | None = Field(default=None, max_length=32)
    amount: Decimal = Field(gt=0, le=Decimal("1000000000000"))
    currency: Literal["INR"] = "INR"
    issue_date: date
    maturity_date: date
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("reference_number")
    @classmethod
    def _reference(cls, value: str) -> str:
        cleaned = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9/_.\- ]{2,63}", cleaned):
            raise ValueError("Use 3-64 letters, digits, spaces or / _ . -")
        return cleaned

    @field_validator("bank_name")
    @classmethod
    def _bank(cls, value: str) -> str:
        cleaned = re.sub(r"\s+", " ", value.strip())
        if len(cleaned) < 2:
            raise ValueError("Enter the issuing bank.")
        return cleaned

    @field_validator("bank_code")
    @classmethod
    def _bank_code(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip().upper()
        return cleaned or None

    @field_validator("notes")
    @classmethod
    def _notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("amount")
    @classmethod
    def _amount(cls, value: Decimal) -> Decimal:
        if value.as_tuple().exponent < -2:
            raise ValueError("Use at most two decimal places.")
        return value

    @model_validator(mode="after")
    def _dates(self):
        if self.maturity_date <= self.issue_date:
            raise ValueError("Maturity date must be after the issue date.")
        if (self.maturity_date - self.issue_date).days > 365 * 20:
            raise ValueError("Tenure longer than 20 years is not supported.")
        return self


class FdrCreate(FdrFields):
    submit_for_review: bool = False


class FdrUpdate(BaseModel):
    reference_number: str | None = Field(default=None, min_length=3, max_length=64)
    bank_name: str | None = Field(default=None, min_length=2, max_length=160)
    bank_code: str | None = Field(default=None, max_length=32)
    amount: Decimal | None = Field(default=None, gt=0, le=Decimal("1000000000000"))
    issue_date: date | None = None
    maturity_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    expected_version: int | None = None

    @field_validator("reference_number")
    @classmethod
    def _reference(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9/_.\- ]{2,63}", cleaned):
            raise ValueError("Use 3-64 letters, digits, spaces or / _ . -")
        return cleaned

    @field_validator("bank_name")
    @classmethod
    def _bank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = re.sub(r"\s+", " ", value.strip())
        if len(cleaned) < 2:
            raise ValueError("Enter the issuing bank.")
        return cleaned

    @field_validator("amount")
    @classmethod
    def _amount(cls, value: Decimal | None) -> Decimal | None:
        if value is not None and value.as_tuple().exponent < -2:
            raise ValueError("Use at most two decimal places.")
        return value

    @field_validator("notes")
    @classmethod
    def _notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class TransitionRequest(BaseModel):
    action: str = Field(min_length=3, max_length=40)
    reason: str | None = Field(default=None, max_length=2000)
    expected_version: int | None = None

    @field_validator("action")
    @classmethod
    def _action(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class VerificationRequest(BaseModel):
    method: Literal["MANUAL", "PROVIDER"]
    notes: str | None = Field(default=None, max_length=2000)
    evidence_reference: str | None = Field(default=None, max_length=120)
    expected_version: int | None = None

    @field_validator("notes")
    @classmethod
    def _notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class ExtractionReviewItem(BaseModel):
    extraction_id: str = Field(min_length=8, max_length=36)
    review_status: Literal["CONFIRMED", "CORRECTED", "DISMISSED"]
    corrected_value: str | None = Field(default=None, max_length=160)

    @model_validator(mode="after")
    def _correction(self):
        if self.review_status == "CORRECTED" and not (self.corrected_value or "").strip():
            raise ValueError("A corrected value is required when recording a correction.")
        return self


class ExtractionReviewRequest(BaseModel):
    reviews: list[ExtractionReviewItem] = Field(min_length=1, max_length=50)
    note: str | None = Field(default=None, max_length=1000)


class RenewalRequest(BaseModel):
    relationship_type: Literal["RENEWAL", "REPLACEMENT"] = "RENEWAL"
    reason: str = Field(min_length=10, max_length=2000)
    new_fdr: FdrFields


class ReleaseRequestCreate(BaseModel):
    fdr_id: str = Field(min_length=8, max_length=36)
    request_reason: str = Field(min_length=10, max_length=2000)
    expected_version: int | None = None

    @field_validator("request_reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 10:
            raise ValueError("Explain the release request in at least 10 characters.")
        return cleaned


class ReleaseDecisionRequest(BaseModel):
    decision: Literal["APPROVE", "REJECT", "RETURN"]
    reason: str = Field(min_length=5, max_length=2000)
    expected_version: int | None = None

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 5:
            raise ValueError("Record a decision reason of at least 5 characters.")
        return cleaned


class UserAdminUpdate(BaseModel):
    role: Literal[
        "INSTITUTION_ADMIN",
        "REVIEWING_OFFICER",
        "APPROVING_OFFICER",
        "AUDITOR",
        "SYSTEM_ADMIN",
    ] | None = None
    is_active: bool | None = None
    institution_id: str | None = None
