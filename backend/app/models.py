"""SQLAlchemy models.

Money is stored as integer paise (minor units) so no floating point value ever
touches a stored amount. The API exposes decimal strings and the UI formats
them; the database stays exact.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    """Naive UTC timestamp (SQLite stores naive values; Postgres uses UTC)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class Institution(Base, TimestampMixin):
    __tablename__ = "institutions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    institution_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(254), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", nullable=False)

    users: Mapped[list["User"]] = relationship(back_populates="institution")
    fdrs: Mapped[list["FdrRecord"]] = relationship(back_populates="institution")


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    institution_id: Mapped[str | None] = mapped_column(
        ForeignKey("institutions.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    institution: Mapped[Institution | None] = relationship(back_populates="users")
    sessions: Mapped[list["UserSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    refresh_token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    csrf_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")


class FdrRecord(Base, TimestampMixin):
    __tablename__ = "fdr_records"
    __table_args__ = (
        UniqueConstraint(
            "institution_id", "reference_number", name="uq_fdr_reference_per_institution"
        ),
        Index("ix_fdr_maturity_date", "maturity_date"),
        Index("ix_fdr_lifecycle_status", "lifecycle_status"),
        Index("ix_fdr_institution_status", "institution_id", "lifecycle_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    institution_id: Mapped[str] = mapped_column(
        ForeignKey("institutions.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    reference_number: Mapped[str] = mapped_column(String(64), nullable=False)
    bank_name: Mapped[str] = mapped_column(String(160), nullable=False)
    bank_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    maturity_date: Mapped[date] = mapped_column(Date, nullable=False)
    lifecycle_status: Mapped[str] = mapped_column(String(32), default="DRAFT", nullable=False)
    verification_status: Mapped[str] = mapped_column(
        String(32), default="UNVERIFIED", nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    released_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    institution: Mapped[Institution] = relationship(back_populates="fdrs")
    documents: Mapped[list["FdrDocument"]] = relationship(
        back_populates="fdr", cascade="all, delete-orphan"
    )
    workflow_events: Mapped[list["WorkflowEvent"]] = relationship(
        back_populates="fdr", cascade="all, delete-orphan"
    )
    verification_checks: Mapped[list["VerificationCheck"]] = relationship(
        back_populates="fdr", cascade="all, delete-orphan"
    )
    release_requests: Mapped[list["ReleaseRequest"]] = relationship(
        back_populates="fdr", cascade="all, delete-orphan"
    )
    notifications: Mapped[list["Notification"]] = relationship(
        back_populates="fdr", cascade="all, delete-orphan"
    )


class FdrDocument(Base):
    __tablename__ = "fdr_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    fdr_id: Mapped[str] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storage_key: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    document_type: Mapped[str] = mapped_column(String(40), default="FDR_RECEIPT", nullable=False)
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    scan_status: Mapped[str] = mapped_column(String(32), default="NOT_SCANNED", nullable=False)
    extraction_status: Mapped[str] = mapped_column(String(32), default="PENDING", nullable=False)
    extraction_engine: Mapped[str | None] = mapped_column(String(40), nullable=True)
    extraction_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    extracted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    fdr: Mapped[FdrRecord] = relationship(back_populates="documents")
    extractions: Mapped[list["OcrExtraction"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class OcrExtraction(Base):
    __tablename__ = "ocr_extractions"
    __table_args__ = (
        UniqueConstraint("document_id", "field_name", name="uq_extraction_field_per_document"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    document_id: Mapped[str] = mapped_column(
        ForeignKey("fdr_documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_name: Mapped[str] = mapped_column(String(40), nullable=False)
    extracted_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(nullable=True)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    review_status: Mapped[str] = mapped_column(String(20), default="PENDING", nullable=False)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    corrected_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    document: Mapped[FdrDocument] = relationship(back_populates="extractions")


class VerificationCheck(Base):
    __tablename__ = "verification_checks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    fdr_id: Mapped[str] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    method: Mapped[str] = mapped_column(String(24), nullable=False)
    provider: Mapped[str] = mapped_column(String(80), nullable=False)
    result: Mapped[str] = mapped_column(String(40), nullable=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    checked_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    evidence_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    fdr: Mapped[FdrRecord] = relationship(back_populates="verification_checks")


class WorkflowEvent(Base):
    __tablename__ = "workflow_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    fdr_id: Mapped[str] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_label: Mapped[str] = mapped_column(String(160), nullable=False)
    from_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_state: Mapped[str | None] = mapped_column(String(32), nullable=True)
    action: Mapped[str] = mapped_column(String(48), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    fdr: Mapped[FdrRecord] = relationship(back_populates="workflow_events")


class RenewalLink(Base):
    __tablename__ = "renewal_links"
    __table_args__ = (
        UniqueConstraint("successor_fdr_id", name="uq_renewal_successor"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    previous_fdr_id: Mapped[str] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    successor_fdr_id: Mapped[str] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="RESTRICT"), nullable=False
    )
    relationship_type: Mapped[str] = mapped_column(String(24), default="RENEWAL", nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class ReleaseRequest(Base):
    __tablename__ = "release_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    fdr_id: Mapped[str] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    request_reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="PENDING_CHECKER", nullable=False)
    checker_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    previous_lifecycle_state: Mapped[str] = mapped_column(String(32), nullable=False)
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    fdr: Mapped[FdrRecord] = relationship(back_populates="release_requests")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uq_notification_dedupe_key"),
        Index("ix_notification_recipient", "recipient_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    fdr_id: Mapped[str] = mapped_column(
        ForeignKey("fdr_records.id", ondelete="CASCADE"), nullable=False, index=True
    )
    recipient_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    alert_type: Mapped[str] = mapped_column(String(32), nullable=False)
    threshold_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dedupe_key: Mapped[str] = mapped_column(String(160), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), default="IN_APP", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="DELIVERED", nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    delivery_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(String(255), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)

    fdr: Mapped[FdrRecord] = relationship(back_populates="notifications")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (UniqueConstraint("sequence", name="uq_audit_sequence"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_label: Mapped[str] = mapped_column(String(160), default="system", nullable=False)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    event_payload: Mapped[str] = mapped_column(Text, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    previous_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    event_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
