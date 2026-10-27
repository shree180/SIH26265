import { ArrowLeft, FileUp, Info, Save, Send, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import {
  Button,
  InlineAlert,
  LinkButton,
  Panel,
  TextField,
  TextareaField,
} from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fileSize } from "../lib/format";
import type { DocumentInfo, FdrDetail } from "../lib/types";

interface FormState {
  reference_number: string;
  bank_name: string;
  bank_code: string;
  amount: string;
  issue_date: string;
  maturity_date: string;
  notes: string;
}

const EMPTY: FormState = {
  reference_number: "",
  bank_name: "",
  bank_code: "",
  amount: "",
  issue_date: "",
  maturity_date: "",
  notes: "",
};

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg"];

function localIsoDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export default function NewFdrPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
    setDirty(true);
  };

  const validate = (): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!form.reference_number.trim()) next.reference_number = "Enter the FDR reference number.";
    else if (!/^[A-Za-z0-9][A-Za-z0-9/_.\- ]{2,63}$/.test(form.reference_number.trim())) {
      next.reference_number = "Use 3–64 letters, digits, spaces or / _ . -";
    }
    if (form.bank_name.trim().length < 2) next.bank_name = "Enter the issuing bank.";
    if (!form.amount.trim()) next.amount = "Enter the deposit amount.";
    else if (!Number.isFinite(Number(form.amount)) || Number(form.amount) <= 0) {
      next.amount = "Enter an amount greater than zero.";
    } else if (Number(form.amount) > 1_000_000_000_000) {
      next.amount = "Amount exceeds the supported limit.";
    } else if (!/^\d+(\.\d{1,2})?$/.test(form.amount.trim())) {
      next.amount = "Use up to two decimal places.";
    }
    if (!form.issue_date) next.issue_date = "Enter the issue date.";
    else if (form.issue_date > localIsoDate()) next.issue_date = "Issue date cannot be in the future.";
    if (!form.maturity_date) next.maturity_date = "Enter the maturity date.";
    else if (form.issue_date && form.maturity_date <= form.issue_date) {
      next.maturity_date = "Maturity date must be after the issue date.";
    }
    return next;
  };

  const pickFile = (chosen: File | null) => {
    setFileError(null);
    if (!chosen) {
      setFile(null);
      return;
    }
    if (!ALLOWED_TYPES.includes(chosen.type)) {
      setFileError("Upload a PDF, PNG or JPEG document.");
      setFile(null);
      return;
    }
    if (chosen.size > MAX_FILE_BYTES) {
      setFileError("Documents must be 5 MB or smaller.");
      setFile(null);
      return;
    }
    setFile(chosen);
    setDirty(true);
  };

  const persist = async (submit: boolean) => {
    if (draftId) return;
    const clientErrors = validate();
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setGeneralError("Some fields need attention. Review the highlighted fields.");
      const first = document.getElementById(`fdr-${Object.keys(clientErrors)[0]}`);
      first?.focus();
      first?.scrollIntoView({ block: "center" });
      return;
    }

    setSaving(submit ? "submit" : "draft");
    setGeneralError(null);

    try {
      const created = await api.post<FdrDetail>("/fdrs", {
        reference_number: form.reference_number.trim(),
        bank_name: form.bank_name.trim(),
        bank_code: form.bank_code.trim() || null,
        amount: form.amount.trim(),
        issue_date: form.issue_date,
        maturity_date: form.maturity_date,
        notes: form.notes.trim() || null,
        submit_for_review: false,
      });
      setDraftId(created.id);

      if (file) {
        const data = new FormData();
        data.append("file", file);
        data.append("document_type", "FDR_RECEIPT");
        try {
          await api.upload<DocumentInfo>(`/fdrs/${created.id}/documents`, data);
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "The upload failed.";
          setGeneralError(
            `The draft was saved, but the document upload failed: ${message} The record has NOT been submitted. Open the draft to retry the upload.`,
          );
          setSaving(null);
          return;
        }
      }

      if (submit) {
        try {
          await api.post<FdrDetail>(`/fdrs/${created.id}/transition`, {
            action: "SUBMIT",
            reason: file
              ? "Submitted with supporting document."
              : "Submitted without supporting document; evidence to follow.",
          });
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Submission failed.";
          setGeneralError(
            `The draft and document were saved, but the record was NOT submitted: ${message}`,
          );
          setSaving(null);
          return;
        }
      }

      setDirty(false);
      toast.success(
        submit
          ? "FDR submitted. It is now awaiting review."
          : "Draft saved. Add evidence and submit when ready.",
      );
      navigate(`/app/fdrs/${created.id}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === "DUPLICATE_REFERENCE") {
          setErrors({ reference_number: "This reference already exists for your institution." });
        } else if (caught.fields.length > 0) {
          setErrors(
            Object.fromEntries(caught.fields.map((field) => [field.field, field.message])),
          );
        }
        setGeneralError(caught.message);
      } else {
        setGeneralError("The record could not be saved. Try again.");
      }
    } finally {
      setSaving(null);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void persist(true);
  };

  const errorList = Object.entries(errors).filter(([, message]) => message);

  return (
    <div className="space-y-5">
      <header>
        <Link
          to="/app/fdrs"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink"
        >
          <ArrowLeft size={14} aria-hidden /> FDR records
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Submit an FDR</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          Record the deposit for {user?.institution?.name ?? "your institution"} and attach the
          synthetic receipt. A reviewer checks the evidence before the record becomes active.
        </p>
      </header>

      {generalError && (
        <div role="alert">
          <InlineAlert tone="danger" title="Submission not completed">
            {generalError}
            {draftId && (
              <span className="mt-1 block">
                <Link
                  to={`/app/fdrs/${draftId}`}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Open the saved draft
                </Link>{" "}
                to retry the remaining step.
              </span>
            )}
          </InlineAlert>
        </div>
      )}

      {errorList.length > 0 && (
        <InlineAlert tone="warning" title="Check these fields">
          <ul className="list-inside list-disc space-y-0.5">
            {errorList.map(([field, message]) => (
              <li key={field}>
                <a
                  href={`#fdr-${field}`}
                  className="underline underline-offset-2"
                  onClick={() => {
                    document.getElementById(`fdr-${field}`)?.focus();
                  }}
                >
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </InlineAlert>
      )}

      <form onSubmit={onSubmit} noValidate>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <Panel title="Institution" description="Set from your signed-in account.">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-[220px] flex-1 rounded-md border border-line bg-canvas px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                    Institution
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {user?.institution?.name ?? "Not linked"}
                  </p>
                  <p className="text-xs text-muted">{user?.institution?.institution_code}</p>
                </div>
                <p className="max-w-xs text-xs leading-5 text-muted">
                  Records and documents are visible only to this institution and authorised
                  reviewing roles.
                </p>
              </div>
            </Panel>

            <Panel
              title="FDR details"
              description="Use the values printed on the receipt. Submitted values are stored separately from extracted values."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField
                  id="fdr-reference_number"
                  label="FDR reference number"
                  required
                  value={form.reference_number}
                  onChange={(event) => update("reference_number", event.target.value)}
                  maxLength={64}
                  placeholder="e.g. DIT/FDR/2026/011"
                  error={errors.reference_number}
                  hint="Must be unique within your institution."
                  autoComplete="off"
                />
                <TextField
                  id="fdr-bank_name"
                  label="Issuing bank"
                  required
                  value={form.bank_name}
                  onChange={(event) => update("bank_name", event.target.value)}
                  maxLength={160}
                  placeholder="e.g. State Bank of India (Demo)"
                  error={errors.bank_name}
                  autoComplete="organization"
                />
                <TextField
                  id="fdr-bank_code"
                  label="Bank code (optional)"
                  value={form.bank_code}
                  onChange={(event) => update("bank_code", event.target.value.toUpperCase())}
                  maxLength={32}
                  hint="If your process uses a short bank code."
                  autoComplete="off"
                />
                <TextField
                  id="fdr-amount"
                  label="Deposit amount (INR)"
                  required
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) => update("amount", event.target.value)}
                  placeholder="e.g. 1250000.00"
                  error={errors.amount}
                  hint="Stored exactly; two decimal places."
                  autoComplete="off"
                />
                <TextField
                  id="fdr-issue_date"
                  label="Issue date"
                  type="date"
                  required
                  value={form.issue_date}
                  max={localIsoDate()}
                  onChange={(event) => update("issue_date", event.target.value)}
                  error={errors.issue_date}
                />
                <TextField
                  id="fdr-maturity_date"
                  label="Maturity date"
                  type="date"
                  required
                  value={form.maturity_date}
                  min={form.issue_date || undefined}
                  onChange={(event) => update("maturity_date", event.target.value)}
                  error={errors.maturity_date}
                />
              </div>
              <div className="mt-4">
                <TextareaField
                  id="fdr-notes"
                  label="Notes for the reviewer (optional)"
                  rows={3}
                  maxLength={2000}
                  value={form.notes}
                  onChange={(event) => update("notes", event.target.value)}
                  hint="Do not include personal financial data in a demo environment."
                />
              </div>
            </Panel>

            <Panel
              title="Supporting document"
              description="Optional now, but a missing receipt is flagged and may require correction."
            >
              <div className="space-y-3">
                <label
                  htmlFor="fdr-file"
                  className="flex cursor-pointer flex-col items-start gap-2 rounded-md border border-dashed border-line bg-canvas/50 px-4 py-5 hover:border-primary/40"
                >
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
                    <FileUp size={16} className="text-primary" aria-hidden />
                    Choose a synthetic FDR receipt
                  </span>
                  <span className="text-xs leading-5 text-muted">
                    PDF, PNG or JPEG · up to 5 MB. PDF text is extracted for comparison; image OCR
                    is unavailable in this environment.
                  </span>
                  <input
                    id="fdr-file"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                    className="sr-only"
                    onChange={(event) => pickFile(event.target.files?.[0] ?? null)}
                    disabled={Boolean(draftId)}
                  />
                </label>

                {fileError && (
                  <p role="alert" className="text-xs text-danger">
                    {fileError}
                  </p>
                )}

                {file && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{file.name}</p>
                      <p className="text-[11px] text-muted">
                        {fileSize(file.size)} · {file.type || "unknown type"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => pickFile(null)}
                      className="rounded p-1 text-muted hover:bg-canvas hover:text-ink"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X size={15} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            </Panel>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <LinkButton to="/app/fdrs" variant="secondary">
                Cancel
              </LinkButton>
              <Button
                type="button"
                variant="secondary"
                icon={<Save size={15} aria-hidden />}
                loading={saving === "draft"}
                disabled={Boolean(draftId) || saving !== null}
                onClick={() => void persist(false)}
              >
                Save as draft
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon={<Send size={15} aria-hidden />}
                loading={saving === "submit"}
                disabled={Boolean(draftId) || saving !== null}
              >
                Submit for review
              </Button>
            </div>
          </div>

          <aside className="space-y-4">
            <Panel title="What happens next">
              <ol className="space-y-3 text-sm">
                {[
                  "The record is saved as a draft and the receipt is stored privately.",
                  "Text is extracted from a PDF and compared with the submitted values.",
                  "A reviewing officer checks the evidence and records a decision.",
                  "Once verified and activated, maturity monitoring begins.",
                ].map((step, index) => (
                  <li key={step} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[11px] font-semibold text-muted tnum">
                      {index + 1}
                    </span>
                    <span className="leading-6 text-muted">{step}</span>
                  </li>
                ))}
              </ol>
            </Panel>

            <div className="rounded-md border border-line bg-surface px-4 py-3">
              <p className="flex items-center gap-1.5 text-[12px] font-medium">
                <ShieldCheck size={14} className="text-primary" aria-hidden />
                Evidence provenance
              </p>
              <p className="mt-1.5 text-[11px] leading-5 text-muted">
                Extraction is a candidate value, not proof. A matching format or file upload never
                confirms that an FDR is genuine; that needs an authorised bank source.
              </p>
            </div>

            <div className="rounded-md border border-line bg-surface px-4 py-3">
              <p className="flex items-center gap-1.5 text-[12px] font-medium">
                <Info size={14} className="text-muted" aria-hidden />
                Demo data only
              </p>
              <p className="mt-1.5 text-[11px] leading-5 text-muted">
                Do not upload real institutional or personal financial documents in this prototype.
              </p>
            </div>
          </aside>
        </div>
      </form>
    </div>
  );
}
