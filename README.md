# FDR Sentinel — SIH26265

*Streamline of Security Deposit / FDR Portal* (Smart India Hackathon 2026, problem statement
SIH26265; the organisation shown in the SIH listing is AICTE — this repository is not an official
AICTE product).

A role-based workspace for tracking Fixed Deposit Receipts (FDRs) used as security deposits:
submission, private evidence, document extraction and discrepancy review, manual verification,
lifecycle control, maturity alerting, renewal history, maker-checker release, audit trail, and
CSV reporting.

Built against the SIH26265 problem statement material in `details_SIH.md` (domain/architecture)
and `PRD_SIH.md` (product/UX/security/acceptance). **This is a prototype, not an official AICTE
product, and it does not talk to any bank.**

> **Honesty rule enforced throughout this build:** a file upload, matching text, or a simulated
> provider response does **not** prove an FDR is genuine. Independent confirmation requires an
> authorised bank or trusted data source. No such integration exists here. The demo therefore
> distinguishes *submitted*, *extracted*, *manually reviewed*, and *simulation-only* values
> everywhere they appear.

---

## 1. What is implemented, tested, simulated, incomplete

| Area | State | Notes |
| --- | --- | --- |
| Sign-in, session cookies, CSRF, login throttling | **Implemented + tested** | Argon2id hashes, HS256 access token in an HttpOnly cookie, SHA-256-hashed session records, server-side revocation. |
| Role and institution authorization | **Implemented + tested** | Enforced in services/dependencies, not the UI. Cross-institution reads return 404, not 403, so existence is not disclosed. |
| FDR create / read / update / search / filter / pagination | **Implemented + tested** | Money stored as integer paise; no floating point. Optimistic `version` check on edits. |
| Private document upload/download | **Implemented + tested** | Stored under `backend/var/private_uploads` with random keys, never publicly mounted. Every download is authorized and audited. Types limited to PDF/PNG/JPEG with size limit. |
| PDF text-layer extraction | **Implemented (real), limited** | `pypdf` reads reference, bank, amount, issue and maturity dates from a PDF text layer, with no confidence score. |
| Image OCR | **Not available** | No Tesseract/PaddleOCR binary in this environment. Image uploads are accepted but extraction reports `UNAVAILABLE`. The UI says so; nothing is faked. |
| Discrepancy panel + extraction review | **Implemented + tested** | Field-by-field comparison against submitted values, reviewer confirm/correct/dismiss, unresolved-discrepancy counts. |
| Manual verification | **Implemented + tested** | Reviewer records outcome, evidence reference and reason; sets `MANUAL_CONFIRMED` / `MISMATCH_REPORTED` / `FAILED_VERIFICATION`. |
| Simulated bank verification | **Simulated, clearly labelled** | `BANK_VERIFICATION_MODE=simulated` adds a local hash-based stub. Results are stored as `SIMULATION_ONLY` and never count as confirmation. Default is `manual`. |
| Lifecycle state machine | **Implemented + tested** | One central transition table (`backend/app/domain.py`) with allowed states, roles and required reasons; illegal transitions are rejected server-side. |
| Maturity scheduler + alerts | **Implemented + tested** | APScheduler daily job (in-process, single instance) plus startup scan and admin "run now". One alert per FDR × threshold × recipient, idempotent. |
| Explainable priority score | **Implemented + tested** | Deterministic rule weights with human-readable reasons, returned by the API and shown in the UI/CSV. It is a triage aid, not a risk rating. |
| Renewal / replacement history | **Implemented + tested** | Successor records link to a predecessor; the predecessor is retained, never overwritten. |
| Maker-checker release | **Implemented + tested** | Institution raises the request; a different approving officer decides. Self-approval, self-decision and duplicate pending requests are rejected server-side. Approval records a decision only — no funds move. |
| Hash-chained audit trail + verification | **Implemented + tested** | Append-only events with `previous_hash`/`event_hash`; auditors and admins can recompute the chain. Tamper-evidence only — see limitations. |
| Role-specific dashboards | **Implemented + tested** | Five distinct workspaces (institution, reviewer, checker, auditor, system admin) built from stored records via one scoped endpoint. Asserted in `tests/test_role_dashboards.py`: distinct payload per role, institution isolation, checker queue excludes own requests, and workspace counts reconcile with the shared aggregates. |
| Dashboard, review queue, maturity views | **Implemented, backend-driven** | Every number comes from the API; no hardcoded metrics. |
| CSV export | **Implemented + tested** | Role-scoped, filter-aware, formula-injection mitigated, capped at 5,000 rows, and audited. |
| Admin: users, roles, institutions, integration status, jobs | **Implemented** | Changes are audited; role change/deactivation revokes sessions; last-admin and self-change guards. |
| Automated backend tests | **96 passing** | `backend/tests/` covers domain rules, auth, negative security boundaries, workflow, documents, release, notifications, audit, reports, dashboard and role workspaces. |
| Email / SMS delivery | **Not implemented** | In-app notifications only; the UI states this. |
| PDF reports, bulk import, provider integrations | **Not implemented** | Out of MVP scope. |
| Database migrations | **Not implemented** | Schema is created with `Base.metadata.create_all`. See production gaps. |

---

## 2. Stack and layout

- **Backend:** Python 3.13, FastAPI, SQLAlchemy 2 (sync), Pydantic v2, SQLite locally /
  PostgreSQL in production, APScheduler, PyJWT, Argon2, pypdf, fpdf2 (synthetic demo PDFs).
- **Frontend:** React 19 + TypeScript, Vite, Tailwind CSS v4, React Router, lucide icons.
  No component library; a small set of local primitives in `frontend/src/components/ui.tsx`.
  Each role lands on its own workspace (`src/pages/dashboards/`) fed by one scoped endpoint.
  shadcn/ui, TanStack Query/Table, React Hook Form + Zod and Recharts were considered and
  deliberately **not** adopted: this app already has an equivalent coherent design system, a
  typed fetch client with 401-refresh, accessible tables and inline form validation, and the
  brief was to build on working code rather than replace it. Add them only for a concrete need
  (for example column virtualisation on a very large table).
- **Serving:** in development Vite proxies `/api` to the API. In production the FastAPI app serves
  `frontend/dist` as an SPA.

```text
backend/
  app/
    main.py            app factory, security headers, scheduler, SPA serving
    config.py          environment-driven settings + production guards
    database.py        engine/session factory
    models.py          SQLAlchemy models
    domain.py          roles, lifecycle table, priority rules, date policy
    deps.py            auth, CSRF, scope checks
    security.py        password hashing, JWTs, session tokens, login throttle
    audit.py           hash chain + verification
    services/          fdr, documents, extraction, verification, release, notifications, ...
    routers/           HTTP layer (thin; rules live in services/domain)
    seed.py            synthetic demo data + reset
  tests/               96 pytest tests
frontend/
  src/
    components/        design-system primitives, app shell, detail sections
    pages/             every route (records, review, maturity, release, reports, audit, admin)
    pages/dashboards/  five role workspaces + shared queue/table components
    lib/               typed API client, auth context, formatting, types
```

---

## 3. Quick start (local)

Prerequisites: Python 3.11+, Node 20+.

```bash
# 1. Backend
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
cp .env.example .env                # optional; defaults work for local development
cd backend
python -m app.seed                  # synthetic data + generated sample PDFs
uvicorn app.main:create_app --factory --reload --port 8000
```

```bash
# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev                         # http://127.0.0.1:5173
```

On Windows, if the checkout sits under a very deep path, `venv` creation can hit `MAX_PATH`.
Create the environment somewhere short (for example `python -m venv C:\venvs\fdr`) and install
`-r backend/requirements.txt` into it.

Reset demo data at any time:

```bash
cd backend
python -m app.seed --reset
```

API documentation is at `http://127.0.0.1:8000/api/docs`; health at `/api/v1/health`.

### Production-style run

```bash
cd frontend && npm run build         # emits frontend/dist
cd ../backend && uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000
```

Set at minimum in production: `APP_ENV=production`, a random `JWT_SECRET_KEY` (32+ chars),
`COOKIE_SECURE=true`, HTTPS termination in front, and `DATABASE_URL=postgresql+psycopg://...`.
The app refuses to start in production with the development secret or insecure cookies.

---

## 4. Demo accounts (development only)

All institutions, users, FDR numbers and documents are fabricated. The seed prints the same list.
Shared password: `Sentinel#2026` (override with `DEMO_PASSWORD` before seeding).

| Email | Role | Scope |
| --- | --- | --- |
| `inst.admin@dit.demo` | Institution Administrator | Demo Institute of Technology |
| `inst.admin@nias.demo` | Institution Administrator | National Institute of Applied Sciences |
| `reviewer@fdr.demo` | Reviewing Officer | All institutions |
| `checker@fdr.demo` | Approving Officer | All institutions |
| `auditor@fdr.demo` | Auditor (read-only) | All institutions |
| `sysadmin@fdr.demo` | System Administrator | All institutions |

Seeded records cover: active and maturing soon, missing evidence, an amount discrepancy under
review, correction required, a release awaiting a checker, a renewal chain, an overdue deposit, a
rejected submission, a released record, and one record owned by the *other* institution (to
demonstrate isolation).

### Role workspaces (what each account sees first)

All five workspaces render from the single scoped endpoint `GET /api/v1/dashboard/summary`, whose
`workspace` block is shaped per role. Nothing on them is hardcoded or estimated; every count is
computed from stored records for that role's scope.

| Role | Workspace | What it answers with real data |
| --- | --- | --- |
| Institution Administrator | *Your institution's deposits* | Counted action items (corrections, missing receipts, unconfirmed extracted values, drafts, rejections), extraction health, its own release requests, upcoming maturities, recent submissions |
| Reviewing Officer | *Review workspace* | Priority-ordered review inbox with the blocking reason per record, discrepancy worklist, corrections in flight, maturity risk, SLA-overdue count |
| Approving Officer | *Checker workspace* | Release requests awaiting this checker (maker excluded), decided-by-you history, SLA ageing, and an explicit separation-of-duties panel |
| Auditor | *Audit workspace* | Read-only coverage counts, verification provenance (manual vs simulated), recent lifecycle transitions with actor, and a working hash-chain check |
| System Administrator | *Platform operations* | Accounts by role, active sessions, scheduler state + last run, delivery/extraction health, labelled integration states, release queue, chain check, recent administrative events |

### 5-minute demo path

1. Sign in as `inst.admin@dit.demo`; the overview is the **institution workspace**. Open **FDR Records**.
2. Create a record (or open `DIT/FDR/2026/003`) and show the extracted values versus submitted
   values in the discrepancy panel.
3. Sign in as `reviewer@fdr.demo`; open **Review Queue**, request a correction or record manual
   verification, then activate.
4. Open **Maturity & Alerts**: show thresholds, an overdue alert and the priority reasons.
5. As the institution, request release on an active record.
6. Show that the same user cannot approve it (button disabled *and* the API rejects it).
7. Sign in as `checker@fdr.demo` and decide the request.
8. Open **Audit Trail** and run **Verify chain** as the auditor; show the hash-linked events.
9. Open **Reports** and export a filtered CSV; note the audit entry for the export.

---

## 5. Security model (server-side)

- **Authentication:** Argon2id password hashes; short-lived access JWT (15 min) in an HttpOnly,
  SameSite=Lax cookie; rotating refresh session stored as a SHA-256 hash with expiry/revocation.
  Changing role or deactivating an account revokes sessions.
- **CSRF:** double-submit cookie plus a server-side token hash check on every unsafe method.
- **Authorization:** every route goes through a dependency that loads the user and session; scope
  checks live in services (`scoped_ids`, `assert_fdr_read`, release maker-checker logic). The UI
  hides controls but the server independently rejects them.
- **Uploads:** extension + declared type + size checked; random storage keys; no public mount;
  downloads are authorized and audited. Malware scanning is **not** configured.
- **CSV:** values starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` to prevent
  spreadsheet formula execution.
- **Audit:** append-only rows chained by SHA-256 over canonical fields plus the previous hash.
  Chain verification reports the first broken sequence.
- **Headers:** `nosniff`, `DENY` framing, `no-referrer`, restrictive permissions policy,
  `no-store` on API responses, HSTS when secure cookies are enabled.
- **Rate limiting:** per-email/IP login throttle with lockout (in-process; see limitations).

---

## 6. Tests and checks

```bash
# Backend
cd backend
python -m pytest                 # 88 tests

# Frontend
cd frontend
npm run typecheck                # tsc --noEmit
npm run build                    # typecheck + production bundle
```

The suite is deliberately negative-heavy: cross-institution access, auditor write attempts,
CSRF-less writes, self-approved releases, duplicate pending releases, illegal lifecycle
transitions, formula-injection payloads, export scoping, alert de-duplication, and audit-chain
tamper detection are all covered.

There are **no frontend unit or end-to-end tests**. The UI was verified by building it and by
driving the running app in a browser (sign-in, navigation, record detail, reports, audit, admin);
that is a manual check, not an automated regression suite.

---

## 7. Configuration

All settings are environment variables (see `.env.example`). Most relevant:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | SQLite at `backend/var/fdr_sentinel.db` | Production target is PostgreSQL. |
| `JWT_SECRET_KEY` | dev-only value | Must be random and 32+ chars in production. |
| `COOKIE_SECURE` | `false` | Must be `true` in production. |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS allow-list; keep narrow. |
| `UPLOAD_DIR` | `backend/var/private_uploads` | Private storage; never serve statically. |
| `MAX_UPLOAD_BYTES` | 5 MiB | Per-document limit. |
| `BANK_VERIFICATION_MODE` | `manual` | `simulated` enables the labelled demo stub. |
| `BUSINESS_TIMEZONE` | `Asia/Kolkata` | Business date for maturity maths. |
| `MATURITY_THRESHOLDS` | `30,15,7` | Alert thresholds in days, plus overdue. |
| `MATURITY_SCAN_HOUR_UTC` | `2` | Daily scheduler time. |
| `SCHEDULER_ENABLED` / `SCAN_ON_STARTUP` | `true` | In-process APScheduler; disable in tests. |
| `REVIEW_SLA_HOURS` / `APPROVAL_SLA_HOURS` | `48` | Drive priority factors. |

---

## 8. Known limitations and production gaps

Honest list — none of these are hidden in the UI:

1. **No bank integration.** There is no authorised bank API, credential, or dataset. Verification
   is manual by default; the simulated adapter is local, hash-derived demo behaviour and is
   labelled as such. Authenticity is never asserted.
2. **No image OCR.** Only PDF text-layer extraction is real. Scanned image receipts need an OCR
   engine that is not installed here; the UI reports `UNAVAILABLE` rather than inventing fields.
3. **No malware scanning** on uploads. Document uploads are private and access-controlled, but a
   production system needs AV/CDR scanning and object storage with signed URLs.
4. **No database migrations.** Schema is created with `create_all`, which cannot evolve a live
   schema. Add Alembic before any real deployment. The PostgreSQL path is configured and
   documented but was **not executed** in this environment (no Postgres server available), so it
   is unverified.
5. **In-process scheduler and login throttle.** Both assume a single API process. Multiple
   instances would need leader election or an external scheduler/rate-limit store. Alert
   de-duplication itself is enforced in the database, so repeated scans stay idempotent.
6. **Hash chain is tamper-evidence, not notarisation.** Someone with full database control could
   recompute the whole chain. Export or externally anchor the chain head if that threat matters.
7. **No email/SMS delivery.** Alerts are in-app only (`NOT_CONFIGURED` shown in admin).
8. **No PDF reports, bulk import, or scheduled exports.** CSV only, capped at 5,000 rows, with the
   full match beyond that cap reported honestly.
9. **Synthetic data only.** The seed generates PDFs stamped "SYNTHETIC SAMPLE"; never load real
   financial documents into this prototype.
10. **No frontend automated tests.** Backend coverage is the tested surface; UI checks were manual.
11. **Role semantics are a proposal.** Role names and boundaries must be reconciled with the
    sponsoring organisation's real process; the PRD itself says so. No AICTE requirement is
    asserted here beyond the supplied specification text.

---

## 9. Simulated vs real, at a glance

- **Real:** authentication, authorization, database persistence, private file storage, PDF
  text-layer extraction, discrepancy comparison, lifecycle enforcement, alert scheduling and
  de-duplication, priority computation, maker-checker enforcement, audit chaining, CSV export.
- **Simulated:** bank/provider verification (optional, labelled), and every institution, user,
  receipt and amount in the demo dataset.
- **Absent:** bank connectivity, image OCR, email/SMS, malware scanning, migrations, PDF reports.
