"""Synthetic demo data.

Every institution, user, FDR number and document here is fabricated for the
prototype. Documents are generated PDFs marked "SYNTHETIC SAMPLE"; no real
financial or personal data is used.

Usage (from the backend directory, with the project virtualenv active):

    python -m app.seed
    python -m app.seed --reset     # deletes the local database and uploads first
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select

from .audit import record_audit
from .config import Settings, get_settings
from .database import Base, build_engine, build_session_factory
from .deps import AuthContext
from .domain import LifecycleStatus, business_today
from .models import (
    FdrDocument,
    FdrRecord,
    Institution,
    OcrExtraction,
    ReleaseRequest,
    User,
    new_id,
)
from .money import paise_to_decimal_string
from .schemas import FdrCreate, ReleaseDecisionRequest, ReleaseRequestCreate, RenewalRequest
from .security import hash_password
from .services.extraction import extract_document
from .services.fdr import apply_transition, create_fdr, renew_fdr
from .services.notifications import run_maturity_scan
from .services.release import create_release_request, decide_release_request

DEMO_PASSWORD = "Sentinel#2026"


def _pdf_bytes(lines: list[str]) -> bytes:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    for index, line in enumerate(lines):
        if index == 0:
            pdf.set_font("Helvetica", style="B", size=14)
        elif index == 1:
            pdf.set_font("Helvetica", style="I", size=10)
        else:
            pdf.set_font("Helvetica", size=12)
        pdf.cell(0, 8, text=line, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def _document_lines(
    *,
    reference: str,
    bank: str,
    amount: str,
    issue: date,
    maturity: date,
    institution: str,
) -> list[str]:
    return [
        "FDR SENTINEL - SYNTHETIC SAMPLE DOCUMENT",
        "Generated demo data. This document has no financial value.",
        "",
        f"Reference Number: {reference}",
        f"Bank: {bank}",
        f"Deposit Amount: INR {amount}",
        f"Issue Date: {issue.isoformat()}",
        f"Maturity Date: {maturity.isoformat()}",
        f"Institution: {institution}",
        "",
        "This receipt is not issued by a bank and cannot be verified.",
    ]


def _attach_document(
    db,
    settings: Settings,
    *,
    actor: User,
    fdr: FdrRecord,
    institution_name: str,
    amount_override: str | None = None,
    maturity_override: date | None = None,
    filename: str,
) -> FdrDocument:
    amount = amount_override or paise_to_decimal_string(fdr.amount_paise)
    maturity = maturity_override or fdr.maturity_date
    lines = _document_lines(
        reference=fdr.reference_number,
        bank=fdr.bank_name,
        amount=amount,
        issue=fdr.issue_date,
        maturity=maturity,
        institution=institution_name,
    )
    data = _pdf_bytes(lines)
    from .services.documents import new_storage_key

    storage_key = new_storage_key("pdf")
    destination = Path(settings.upload_dir) / storage_key
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)

    document = FdrDocument(
        id=new_id(),
        fdr_id=fdr.id,
        storage_key=storage_key,
        original_filename=filename,
        content_type="application/pdf",
        size_bytes=len(data),
        sha256_digest=hashlib.sha256(data).hexdigest(),
        document_type="FDR_RECEIPT",
        uploaded_by=actor.id,
        scan_status="NOT_SCANNED",
    )
    db.add(document)
    db.flush()

    outcome = extract_document(data, "application/pdf")
    for field_name, extracted in outcome.fields.items():
        db.add(
            OcrExtraction(
                document_id=document.id,
                field_name=field_name,
                extracted_value=extracted.value,
                confidence=extracted.confidence,
                page_number=extracted.page_number,
                review_status="PENDING",
            )
        )
    document.extraction_status = outcome.status
    document.extraction_engine = outcome.engine
    document.extraction_note = outcome.note
    from .models import utcnow

    document.extracted_at = utcnow()
    record_audit(
        db,
        actor=actor,
        entity_type="FDR",
        entity_id=fdr.id,
        action="DOCUMENT_UPLOADED",
        payload={
            "document_id": document.id,
            "filename": document.original_filename,
            "content_type": document.content_type,
            "size_bytes": document.size_bytes,
            "sha256_digest": document.sha256_digest,
            "document_type": document.document_type,
        },
    )
    record_audit(
        db,
        actor=actor,
        entity_type="FDR",
        entity_id=fdr.id,
        action="DOCUMENT_EXTRACTED",
        payload={
            "document_id": document.id,
            "status": outcome.status,
            "engine": outcome.engine,
            "fields": sorted(outcome.fields.keys()),
        },
    )
    db.commit()
    db.refresh(document)
    return document


def _auth(user: User, settings: Settings) -> AuthContext:
    return AuthContext(user=user, session=None, settings=settings)  # type: ignore[arg-type]


def _advance(db, auth: AuthContext, fdr: FdrRecord, actions: list[tuple[str, str | None]]) -> None:
    for action, reason in actions:
        apply_transition(db, auth, fdr, action=action, reason=reason)
        db.commit()
        db.refresh(fdr)


def seed(db, settings: Settings, *, password: str = DEMO_PASSWORD) -> dict:
    today = business_today(settings.business_timezone)

    institutions = {
        "DIT": Institution(
            id=new_id(),
            institution_code="DIT",
            name="Demo Institute of Technology",
            contact_email="finance@dit.demo",
            status="ACTIVE",
        ),
        "NIAS": Institution(
            id=new_id(),
            institution_code="NIAS",
            name="National Institute of Applied Sciences",
            contact_email="accounts@nias.demo",
            status="ACTIVE",
        ),
        "CPT": Institution(
            id=new_id(),
            institution_code="CPT",
            name="Coastal Polytechnic (Demo)",
            contact_email="office@cpt.demo",
            status="ACTIVE",
        ),
    }
    db.add_all(institutions.values())

    users = {
        "institution_dit": User(
            name="Ananya Rao",
            email="inst.admin@dit.demo",
            password_hash=hash_password(password),
            role="INSTITUTION_ADMIN",
            institution=institutions["DIT"],
        ),
        "institution_nias": User(
            name="Vikram Shah",
            email="inst.admin@nias.demo",
            password_hash=hash_password(password),
            role="INSTITUTION_ADMIN",
            institution=institutions["NIAS"],
        ),
        "reviewer": User(
            name="Meera Iyer",
            email="reviewer@fdr.demo",
            password_hash=hash_password(password),
            role="REVIEWING_OFFICER",
        ),
        "checker": User(
            name="Rahul Menon",
            email="checker@fdr.demo",
            password_hash=hash_password(password),
            role="APPROVING_OFFICER",
        ),
        "auditor": User(
            name="Farah Khan",
            email="auditor@fdr.demo",
            password_hash=hash_password(password),
            role="AUDITOR",
        ),
        "admin": User(
            name="Dev Patel",
            email="sysadmin@fdr.demo",
            password_hash=hash_password(password),
            role="SYSTEM_ADMIN",
        ),
    }
    db.add_all(users.values())
    db.flush()

    for institution in institutions.values():
        record_audit(
            db,
            actor=users["admin"],
            entity_type="INSTITUTION",
            entity_id=institution.id,
            action="INSTITUTION_CREATED",
            payload={
                "institution_code": institution.institution_code,
                "name": institution.name,
            },
        )
    db.commit()

    dit = _auth(users["institution_dit"], settings)
    nias = _auth(users["institution_nias"], settings)
    reviewer = _auth(users["reviewer"], settings)
    checker = _auth(users["checker"], settings)
    dit_name = institutions["DIT"].name

    def make(
        auth: AuthContext,
        *,
        reference: str,
        bank: str,
        amount: str,
        issue_offset: int,
        maturity_offset: int,
        bank_code: str = "SBI",
        notes: str | None = None,
    ) -> FdrRecord:
        return create_fdr(
            db,
            auth,
            FdrCreate(
                reference_number=reference,
                bank_name=bank,
                bank_code=bank_code,
                amount=Decimal(amount),
                issue_date=today - timedelta(days=issue_offset),
                maturity_date=today + timedelta(days=maturity_offset),
                notes=notes,
            ),
        )

    seeded: dict[str, str] = {}

    # 1. Active, maturing in 30 days, evidence present.
    fdr1 = make(
        dit,
        reference="DIT/FDR/2026/001",
        bank="State Bank of India (Demo)",
        amount="1250000.00",
        issue_offset=335,
        maturity_offset=30,
    )
    _attach_document(
        db, settings, actor=users["institution_dit"], fdr=fdr1, institution_name=dit_name,
        filename="synthetic-fdr-001.pdf",
    )
    _advance(db, dit, fdr1, [("SUBMIT", "Synthetic demo submission.")])
    _advance(
        db,
        reviewer,
        fdr1,
        [
            ("START_REVIEW", None),
            ("VERIFY", "Synthetic receipt checked: reference, bank, amount and dates agree."),
            ("ACTIVATE", None),
        ],
    )
    seeded["active_30_days"] = fdr1.reference_number

    # 2. Maturing in 7 days with missing evidence, under correction.
    fdr2 = make(
        dit,
        reference="DIT/FDR/2026/002",
        bank="Bank of Baroda (Demo)",
        amount="480000.00",
        issue_offset=358,
        maturity_offset=7,
    )
    _advance(db, dit, fdr2, [("SUBMIT", "Synthetic demo submission.")])
    _advance(
        db,
        reviewer,
        fdr2,
        [
            ("START_REVIEW", None),
            (
                "REQUEST_CORRECTION",
                "Supporting FDR receipt is missing. Upload the synthetic receipt before review.",
            ),
        ],
    )
    seeded["seven_days_missing_evidence"] = fdr2.reference_number

    # 3. Under review with an amount discrepancy between submission and document.
    fdr3 = make(
        dit,
        reference="DIT/FDR/2026/003",
        bank="HDFC Bank (Demo)",
        amount="2500000.00",
        issue_offset=120,
        maturity_offset=240,
    )
    _attach_document(
        db,
        settings,
        actor=users["institution_dit"],
        fdr=fdr3,
        institution_name=dit_name,
        amount_override="2405000.00",
        filename="synthetic-fdr-003.pdf",
    )
    _advance(db, dit, fdr3, [("SUBMIT", "Synthetic demo submission.")])
    _advance(db, reviewer, fdr3, [("START_REVIEW", None)])
    seeded["discrepancy_under_review"] = fdr3.reference_number

    # 4. Awaiting correction after a reviewer decision.
    fdr4 = make(
        dit,
        reference="DIT/FDR/2026/004",
        bank="Punjab National Bank (Demo)",
        amount="975000.00",
        issue_offset=200,
        maturity_offset=160,
    )
    _attach_document(
        db,
        settings,
        actor=users["institution_dit"],
        fdr=fdr4,
        institution_name=dit_name,
        maturity_override=today + timedelta(days=150),
        filename="synthetic-fdr-004.pdf",
    )
    _advance(db, dit, fdr4, [("SUBMIT", "Synthetic demo submission.")])
    _advance(
        db,
        reviewer,
        fdr4,
        [
            ("START_REVIEW", None),
            (
                "REQUEST_CORRECTION",
                "The maturity date on the receipt differs from the submitted date. Correct the record or upload the right receipt.",
            ),
        ],
    )
    seeded["correction_required"] = fdr4.reference_number

    # 5. Release request awaiting a checker decision.
    fdr5 = make(
        dit,
        reference="DIT/FDR/2026/005",
        bank="ICICI Bank (Demo)",
        amount="1500000.00",
        issue_offset=340,
        maturity_offset=25,
        bank_code="ICIC",
    )
    _attach_document(
        db, settings, actor=users["institution_dit"], fdr=fdr5, institution_name=dit_name,
        filename="synthetic-fdr-005.pdf",
    )
    _advance(db, dit, fdr5, [("SUBMIT", "Synthetic demo submission.")])
    _advance(
        db,
        reviewer,
        fdr5,
        [
            ("START_REVIEW", None),
            ("VERIFY", "Synthetic receipt checked against the submitted values."),
            ("ACTIVATE", None),
        ],
    )
    release = create_release_request(
        db,
        dit,
        ReleaseRequestCreate(
            fdr_id=fdr5.id,
            request_reason="Deposit replaced by a fresh FDR; release requested for the superseded receipt.",
        ),
    )
    seeded["release_pending_checker"] = fdr5.reference_number
    seeded["release_request_id"] = release.id

    # 6. Renewal chain with predecessor history preserved.
    old = make(
        dit,
        reference="DIT/FDR/2025/099",
        bank="Canara Bank (Demo)",
        amount="800000.00",
        issue_offset=700,
        maturity_offset=-30,
    )
    _attach_document(
        db, settings, actor=users["institution_dit"], fdr=old, institution_name=dit_name,
        filename="synthetic-fdr-099.pdf",
    )
    _advance(db, dit, old, [("SUBMIT", "Synthetic demo submission.")])
    _advance(
        db,
        reviewer,
        old,
        [
            ("START_REVIEW", None),
            ("VERIFY", "Synthetic receipt checked against the submitted values."),
            ("ACTIVATE", None),
        ],
    )
    from .schemas import FdrFields

    successor = renew_fdr(
        db,
        dit,
        old,
        RenewalRequest(
            relationship_type="RENEWAL",
            reason="Original deposit matured; renewed with the same bank for a further year.",
            new_fdr=FdrFields(
                reference_number="DIT/FDR/2026/006",
                bank_name="Canara Bank (Demo)",
                bank_code="CANARA",
                amount=Decimal("850000.00"),
                issue_date=today - timedelta(days=5),
                maturity_date=today + timedelta(days=360),
            ),
        ),
    )
    _attach_document(
        db, settings, actor=users["institution_dit"], fdr=successor, institution_name=dit_name,
        filename="synthetic-fdr-006.pdf",
    )
    _advance(
        db,
        reviewer,
        successor,
        [
            ("START_REVIEW", None),
            ("VERIFY", "Renewal receipt checked: reference, amount, dates and bank agree."),
            ("ACTIVATE", None),
        ],
    )
    seeded["renewed_predecessor"] = old.reference_number
    seeded["renewed_successor"] = successor.reference_number

    # 7. Overdue record with evidence, for overdue alerts and priority.
    fdr7 = make(
        dit,
        reference="DIT/FDR/2026/007",
        bank="Union Bank of India (Demo)",
        amount="640000.00",
        issue_offset=380,
        maturity_offset=-12,
    )
    _attach_document(
        db, settings, actor=users["institution_dit"], fdr=fdr7, institution_name=dit_name,
        filename="synthetic-fdr-007.pdf",
    )
    _advance(db, dit, fdr7, [("SUBMIT", "Synthetic demo submission.")])
    _advance(
        db,
        reviewer,
        fdr7,
        [
            ("START_REVIEW", None),
            ("VERIFY", "Synthetic receipt checked against the submitted values."),
            ("ACTIVATE", None),
        ],
    )
    seeded["overdue"] = fdr7.reference_number

    # 8. Rejected submission.
    fdr8 = make(
        dit,
        reference="DIT/FDR/2026/008",
        bank="IDBI Bank (Demo)",
        amount="300000.00",
        issue_offset=60,
        maturity_offset=300,
    )
    _advance(db, dit, fdr8, [("SUBMIT", "Synthetic demo submission.")])
    _advance(
        db,
        reviewer,
        fdr8,
        [
            ("START_REVIEW", None),
            ("REJECT", "Duplicate of DIT/FDR/2026/001 submitted in error."),
        ],
    )
    seeded["rejected"] = fdr8.reference_number

    # 9. Released record decided by a different officer.
    fdr9 = make(
        dit,
        reference="DIT/FDR/2026/009",
        bank="Axis Bank (Demo)",
        amount="700000.00",
        issue_offset=400,
        maturity_offset=90,
    )
    _attach_document(
        db, settings, actor=users["institution_dit"], fdr=fdr9, institution_name=dit_name,
        filename="synthetic-fdr-009.pdf",
    )
    _advance(db, dit, fdr9, [("SUBMIT", "Synthetic demo submission.")])
    _advance(
        db,
        reviewer,
        fdr9,
        [
            ("START_REVIEW", None),
            ("VERIFY", "Synthetic receipt checked against the submitted values."),
            ("ACTIVATE", None),
        ],
    )
    release9 = create_release_request(
        db,
        dit,
        ReleaseRequestCreate(
            fdr_id=fdr9.id,
            request_reason="Security deposit no longer required for the completed project.",
        ),
    )
    decide_release_request(
        db,
        checker,
        release9.id,
        ReleaseDecisionRequest(
            decision="APPROVE",
            reason="Evidence and agency confirmation checked. Release approved in this system only.",
        ),
    )
    seeded["released"] = fdr9.reference_number

    # 10. Another institution's record, to demonstrate isolation.
    nias_fdr = make(
        nias,
        reference="NIAS/FDR/2026/101",
        bank="Bank of India (Demo)",
        amount="2100000.00",
        issue_offset=150,
        maturity_offset=215,
    )
    _attach_document(
        db,
        settings,
        actor=users["institution_nias"],
        fdr=nias_fdr,
        institution_name=institutions["NIAS"].name,
        filename="synthetic-fdr-101.pdf",
    )
    _advance(db, nias, nias_fdr, [("SUBMIT", "Synthetic demo submission.")])
    _advance(
        db,
        reviewer,
        nias_fdr,
        [
            ("START_REVIEW", None),
            ("VERIFY", "Synthetic receipt checked against the submitted values."),
            ("ACTIVATE", None),
        ],
    )
    seeded["other_institution"] = nias_fdr.reference_number

    scan = run_maturity_scan(db, settings, actor=None)

    return {
        "institutions": [inst.institution_code for inst in institutions.values()],
        "users": {user.email: user.role for user in users.values()},
        "password": password,
        "fdrs": seeded,
        "maturity_scan": scan,
    }


def reset(settings: Settings) -> None:
    if settings.database_url.startswith("sqlite:///"):
        db_path = Path(settings.database_url.removeprefix("sqlite:///"))
        for candidate in (db_path, db_path.with_suffix(".db-wal"), db_path.with_suffix(".db-shm")):
            if candidate.exists():
                candidate.unlink()
    uploads = Path(settings.upload_dir)
    if uploads.exists():
        shutil.rmtree(uploads)
    uploads.mkdir(parents=True, exist_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed synthetic FDR Sentinel demo data.")
    parser.add_argument("--reset", action="store_true", help="Delete local data before seeding.")
    args = parser.parse_args()

    settings = get_settings()
    settings.ensure_directories()
    if args.reset:
        reset(settings)

    engine = build_engine(settings.database_url)
    Base.metadata.create_all(engine)
    SessionLocal = build_session_factory(engine)

    with SessionLocal() as db:
        existing = db.execute(select(User.id).limit(1)).first()
        if existing:
            raise SystemExit(
                "Database already contains users. Re-run with --reset to rebuild demo data."
            )
        summary = seed(db, settings)

    print("Synthetic demo data seeded. Development accounts only:")
    for email, role in summary["users"].items():
        print(f"  {email:26s} {role}")
    print(f"  Shared demo password: {summary['password']}")
    print(f"  FDRs: {summary['fdrs']}")
    print(f"  Maturity scan: {summary['maturity_scan']}")


if __name__ == "__main__":
    main()
