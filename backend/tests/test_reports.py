"""CSV export: scope, filters and spreadsheet-formula safety."""

import csv
import io


def _rows(response) -> list[dict]:
    return list(csv.DictReader(io.StringIO(response.text)))


def test_export_respects_institution_scope(institution_client, nias_client, seeded):
    dit = institution_client.get("/reports/fdrs.csv")
    assert dit.status_code == 200
    assert dit.headers["content-type"].startswith("text/csv")
    assert "attachment" in dit.headers["content-disposition"]
    dit_rows = _rows(dit)
    assert all(row["Reference"].startswith("DIT/") for row in dit_rows)
    assert len(dit_rows) == 10
    assert dit.headers["x-exported-rows"] == "10"

    nias = nias_client.get("/reports/fdrs.csv")
    nias_rows = _rows(nias)
    assert len(nias_rows) == 1
    assert nias_rows[0]["Reference"] == "NIAS/FDR/2026/101"


def test_export_respects_filters(institution_client, seeded):
    response = institution_client.get("/reports/fdrs.csv", params={"status": "RELEASED"})
    rows = _rows(response)
    assert len(rows) == 1
    assert rows[0]["Reference"] == "DIT/FDR/2026/009"

    search = institution_client.get("/reports/fdrs.csv", params={"search": "2026/007"})
    assert len(_rows(search)) == 1


def test_formula_injection_is_neutralised(institution_client, seeded):
    created = institution_client.post(
        "/fdrs",
        json={
            "reference_number": "DIT/FDR/2026/940",
            "bank_name": "=cmd|' /C calc'!A0",
            "amount": "100000.00",
            "issue_date": "2024-06-01",
            "maturity_date": "2027-06-01",
        },
    )
    assert created.status_code == 200, created.text

    response = institution_client.get("/reports/fdrs.csv", params={"search": "2026/940"})
    assert response.status_code == 200
    row = _rows(response)[0]
    assert row["Bank"].startswith("'=cmd")
    assert not row["Bank"].startswith("=")


def test_export_requires_authentication(make_client, seeded):
    anonymous = make_client()
    assert anonymous.get("/reports/fdrs.csv").status_code == 401
