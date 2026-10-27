"""Document privacy, upload validation, extraction and discrepancy review."""

from conftest import API


def _pdf(lines: list[str]) -> bytes:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", size=12)
    for line in lines:
        pdf.cell(0, 8, text=line, new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())


def _receipt(reference: str, amount: str = "975,000.00", maturity: str = "2027-03-10") -> bytes:
    return _pdf(
        [
            "FDR SENTINEL - SYNTHETIC SAMPLE",
            "Reference Number: " + reference,
            "Bank: Punjab National Bank (Demo)",
            "Deposit Amount: INR " + amount,
            "Issue Date: 2024-01-15",
            "Maturity Date: " + maturity,
            "Institution: Demo Institute of Technology",
        ]
    )


def _upload(client, fdr_id: str, data: bytes, filename="receipt.pdf", content_type="application/pdf"):
    return client.post(
        f"/fdrs/{fdr_id}/documents",
        data={"document_type": "FDR_RECEIPT"},
        files={"file": (filename, data, content_type)},
    )


def test_upload_extract_and_download(institution_client, seeded):
    fdr = institution_client.detail("DIT/FDR/2026/004")
    response = _upload(institution_client, fdr["id"], _receipt(fdr["reference_number"]))
    assert response.status_code == 200, response.text
    document = response.json()
    assert document["extraction_status"] == "EXTRACTED"
    assert document["scan_status"] == "NOT_SCANNED"
    assert any(item["field_name"] == "reference_number" for item in document["extractions"])

    download = institution_client.get(f"/documents/{document['id']}")
    assert download.status_code == 200
    assert download.content.startswith(b"%PDF")
    assert download.headers["cache-control"] == "private, no-store"
    assert "attachment" in download.headers["content-disposition"]
    assert download.headers["x-content-type-options"] == "nosniff"


def test_discrepancy_panel_reports_amount_mismatch(reviewer_client, seeded):
    detail = reviewer_client.detail("DIT/FDR/2026/003")
    discrepancies = reviewer_client.get(f"/fdrs/{detail['id']}/discrepancies").json()
    amount = next(item for item in discrepancies["fields"] if item["field"] == "amount")
    assert amount["status"] == "MISMATCH"
    assert amount["submitted_value"] == "2500000.00"
    assert amount["extracted_value"].replace(",", "") == "2405000.00"
    assert amount["resolved"] is False
    assert discrepancies["unresolved"] >= 1
    assert detail["priority"]["factors"]


def test_extraction_review_resolves_discrepancy(reviewer_client, seeded):
    detail = reviewer_client.detail("DIT/FDR/2026/003")
    amount_extraction = next(
        extraction
        for document in detail["documents"]
        for extraction in document["extractions"]
        if extraction["field_name"] == "amount"
    )
    before = detail["unresolved_discrepancies"]
    assert before >= 1

    response = reviewer_client.post(
        f"/fdrs/{detail['id']}/extraction-review",
        json={
            "reviews": [
                {
                    "extraction_id": amount_extraction["id"],
                    "review_status": "CONFIRMED",
                }
            ],
            "note": "Receipt value confirmed against the submitted record.",
        },
    )
    assert response.status_code == 200, response.text
    after = response.json()
    assert after["unresolved_discrepancies"] == before - 1
    reviewed = next(item for item in after["discrepancies"] if item["field"] == "amount")
    assert reviewed["status"] == "REVIEWED_OVERRIDE"
    assert reviewed["resolved"] is True


def test_image_extraction_is_reported_unavailable_not_faked(institution_client, seeded):
    fdr = institution_client.detail("DIT/FDR/2026/004")
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
    response = _upload(
        institution_client, fdr["id"], png, filename="scan.png", content_type="image/png"
    )
    assert response.status_code == 200, response.text
    document = response.json()
    assert document["extraction_status"] == "UNAVAILABLE"
    assert document["extractions"] == []
    assert "No OCR engine" in document["extraction_note"]


def test_upload_rejects_disallowed_content(institution_client, seeded):
    fdr = institution_client.detail("DIT/FDR/2026/004")
    spoofed = _upload(
        institution_client,
        fdr["id"],
        b"MZ\x90\x00this-is-not-a-pdf",
        filename="receipt.pdf",
        content_type="application/pdf",
    )
    assert spoofed.status_code == 422

    empty = _upload(institution_client, fdr["id"], b"", filename="empty.pdf")
    assert empty.status_code == 422


def test_upload_size_limit(institution_client, app, seeded):
    fdr = institution_client.detail("DIT/FDR/2026/004")
    app.state.settings.max_upload_bytes = 1024
    oversized = _upload(institution_client, fdr["id"], _receipt(fdr["reference_number"]) * 4)
    assert oversized.status_code == 413


def test_documents_are_owner_and_reviewer_only(
    institution_client, reviewer_client, nias_client, seeded
):
    fdr = institution_client.detail("DIT/FDR/2026/004")
    assert nias_client.get(f"/fdrs/{fdr['id']}").status_code == 404

    reviewer_upload = _upload(reviewer_client, fdr["id"], _receipt(fdr["reference_number"]))
    assert reviewer_upload.status_code == 403

    # Reviewers may trigger extraction for evidence under review.
    under_review = reviewer_client.detail("DIT/FDR/2026/003")
    document_id = under_review["documents"][0]["id"]
    assert reviewer_client.post(f"/documents/{document_id}/extract").status_code == 200
