import {
  ArrowLeft,
  ClipboardCheck,
  FileUp,
  Link2,
  PencilLine,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import {
  AuditTab,
  DocumentsTab,
  OverviewTab,
  RenewalTab,
  VerificationStatusNote,
  WorkflowTab,
} from "../components/FdrDetailSections";
import { ReleaseDecisionDialog } from "../components/ReleaseDecisionDialog";
import {
  Button,
  ErrorState,
  InlineAlert,
  LoadingRows,
  Modal,
  PriorityBadge,
  ReasonDialog,
  SelectField,
  StatusBadge,
  Tabs,
  TextField,
  TextareaField,
  VerificationBadge,
  cn,
} from "../components/ui";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { daysLabel, formatAmount, formatDate, humanAction } from "../lib/format";
import type {
  AvailableTransition,
  DocumentInfo,
  Extraction,
  FdrDetail,
  ReleaseRequest,
} from "../lib/types";

type TabKey = "overview" | "documents" | "workflow" | "renewal" | "audit";

type DialogState =
  | { type: "transition"; action: string; label: string; requireReason: boolean }
  | { type: "verification" }
  | { type: "edit" }
  | { type: "upload" }
  | { type: "release" }
  | { type: "renewal" }
  | { type: "decision"; request: ReleaseRequest }
  | { type: "review"; extraction: Extraction }
  | null;

const REASON_ACTIONS = new Set([
  "REQUEST_CORRECTION",
  "REJECT",
  "MARK_REPLACED",
  "MARK_EXPIRED",
]);

function localIsoDate(offsetDays = 0): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000 + offsetDays * 86_400_000);
  return local.toISOString().slice(0, 10);
}

export default function FdrDetailPage() {
  const { fdrId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();

  const [detail, setDetail] = useState<FdrDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!fdrId) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.get<FdrDetail>(`/fdrs/${fdrId}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this record.");
    } finally {
      setLoading(false);
    }
  }, [fdrId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDialog = (next: DialogState) => {
    setDialogError(null);
    setDialog(next);
  };

  const closeDialog = () => {
    if (busy) return;
    setDialog(null);
    setDialogError(null);
  };

  const handleError = (caught: unknown, fallback: string) => {
    if (caught instanceof ApiError) {
      setDialogError(caught.hint ? `${caught.message} ${caught.hint}` : caught.message);
    } else {
      setDialogError(caught instanceof Error ? caught.message : fallback);
    }
  };

  const runTransition = async (action: string, reason: string) => {
    if (!detail) return;
    setBusy(true);
    setDialogError(null);
    try {
      const updated = await api.post<FdrDetail>(`/fdrs/${detail.id}/transition`, {
        action,
        reason: reason || null,
        expected_version: detail.version,
      });
      setDetail(updated);
      setDialog(null);
      toast.success("Record updated and the change was audited.");
    } catch (caught) {
      handleError(caught, "The lifecycle action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const openTransition = (transition: AvailableTransition) => {
    if (transition.action === "VERIFY") {
      openDialog({ type: "verification" });
      return;
    }
    openDialog({
      type: "transition",
      action: transition.action,
      label: transition.label,
      requireReason: REASON_ACTIONS.has(transition.action),
    });
  };

  if (loading && !detail) {
    return (
      <div className="space-y-4">
        <div className="h-5 w-40 animate-pulse rounded bg-line/60" />
        <div className="panel h-28 animate-pulse bg-line/40" />
        <div className="panel p-4">
          <LoadingRows rows={6} label="Loading record" />
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <Link
          to="/app/fdrs"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink"
        >
          <ArrowLeft size={14} aria-hidden /> FDR records
        </Link>
        <ErrorState message={error ?? "Record not found."} onRetry={() => void load()} />
      </div>
    );
  }

  const lastWorkflow = [...detail.workflow_events].reverse();
  const correctionReason = lastWorkflow.find((event) => event.action === "REQUEST_CORRECTION")?.reason;
  const rejectionReason = lastWorkflow.find((event) => event.action === "REJECT")?.reason;
  const pendingRequest = detail.release_requests.find(
    (request) => request.status === "PENDING_CHECKER",
  );
  const returnedRequest = detail.release_requests.find((request) => request.status === "RETURNED");
  const transitionActions = detail.available_transitions.filter(
    (transition) => transition.action !== "VERIFY",
  );
  const canVerify = detail.available_transitions.some(
    (transition) => transition.action === "VERIFY",
  );

  const tabs: { value: TabKey; label: string; count?: number }[] = [
    { value: "overview", label: "Overview" },
    { value: "documents", label: "Documents & extraction", count: detail.documents.length },
    { value: "workflow", label: "Workflow", count: detail.workflow_events.length },
    { value: "renewal", label: "Renewal history" },
    { value: "audit", label: "Audit trail", count: detail.audit_events.length },
  ];

  return (
    <div className="space-y-5">
      <header className="space-y-4">
        <Link
          to="/app/fdrs"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink"
        >
          <ArrowLeft size={14} aria-hidden /> FDR records
        </Link>

        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{detail.reference_number}</h1>
              <StatusBadge status={detail.lifecycle_status} />
              <VerificationBadge status={detail.verification_status} />
              <PriorityBadge priority={detail.priority} />
            </div>
            <p className="mt-1.5 text-sm text-muted">
              {detail.institution?.name} · {detail.bank_name} ·{" "}
              <span className="tnum">{formatAmount(detail.amount, detail.currency)}</span> · matures{" "}
              {formatDate(detail.maturity_date)} ({daysLabel(detail.days_remaining)})
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Created by {detail.created_by?.name ?? "—"} · record version {detail.version}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {detail.permissions.can_edit && (
              <Button
                variant="secondary"
                size="sm"
                icon={<PencilLine size={14} aria-hidden />}
                onClick={() => openDialog({ type: "edit" })}
              >
                Edit details
              </Button>
            )}
            {detail.permissions.can_upload_document && (
              <Button
                variant="secondary"
                size="sm"
                icon={<FileUp size={14} aria-hidden />}
                onClick={() => openDialog({ type: "upload" })}
              >
                Upload document
              </Button>
            )}
            {transitionActions.map((transition) => (
              <Button
                key={transition.action}
                size="sm"
                variant={
                  ["SUBMIT", "START_REVIEW", "ACTIVATE"].includes(transition.action)
                    ? "primary"
                    : "secondary"
                }
                icon={
                  transition.action === "SUBMIT" ? (
                    <Send size={14} aria-hidden />
                  ) : transition.action === "START_REVIEW" ? (
                    <ClipboardCheck size={14} aria-hidden />
                  ) : undefined
                }
                onClick={() => openTransition(transition)}
              >
                {transition.label}
              </Button>
            ))}
            {canVerify && (
              <Button
                size="sm"
                variant="primary"
                icon={<ShieldCheck size={14} aria-hidden />}
                onClick={() => openDialog({ type: "verification" })}
              >
                Record verification
              </Button>
            )}
            {detail.permissions.can_request_release && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openDialog({ type: "release" })}
              >
                Request release
              </Button>
            )}
            {detail.permissions.can_decide_release && pendingRequest && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => openDialog({ type: "decision", request: pendingRequest })}
              >
                Decide release request
              </Button>
            )}
            {detail.permissions.can_renew && !detail.permissions.can_request_release && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Link2 size={14} aria-hidden />}
                onClick={() => openDialog({ type: "renewal" })}
              >
                Start renewal
              </Button>
            )}
          </div>
        </div>
      </header>

      {detail.lifecycle_status === "CORRECTION_REQUIRED" && (
        <InlineAlert tone="warning" title="Correction requested by the reviewer">
          {correctionReason ?? "Update the record or evidence, then resubmit for review."}
        </InlineAlert>
      )}

      {detail.lifecycle_status === "REJECTED" && (
        <InlineAlert tone="danger" title="Submission rejected">
          {rejectionReason ?? "This submission was rejected and is closed."}
        </InlineAlert>
      )}

      {pendingRequest && (
        <InlineAlert tone="info" title="Release request awaiting an independent checker">
          Raised by {pendingRequest.requested_by?.name ?? "the maker"}. Maker-checker separation
          means a different approving officer must decide. This records an authorisation only; no
          funds move and no bank is contacted.{" "}
          <Link to="/app/release-requests" className="font-medium text-primary underline underline-offset-2">
            Open release queue
          </Link>
        </InlineAlert>
      )}

      {!pendingRequest && returnedRequest && (
        <InlineAlert tone="warning" title="Release request returned for correction">
          {returnedRequest.decision_reason ??
            "A checker returned the release request. Review the reason and raise a new request when ready."}
        </InlineAlert>
      )}

      <VerificationStatusNote detail={detail} />

      {user?.role === "AUDITOR" && (
        <InlineAlert tone="info" title="Read-only workspace">
          Auditors can inspect records, evidence metadata and decisions, but cannot change or approve
          anything.
        </InlineAlert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Deposit amount", value: formatAmount(detail.amount, detail.currency), mono: true },
          { label: "Evidence", value: `${detail.document_count} document${detail.document_count === 1 ? "" : "s"}` },
          {
            label: "Open discrepancies",
            value: `${detail.unresolved_discrepancies}`,
            alert: detail.unresolved_discrepancies > 0,
          },
          { label: "Maturity", value: daysLabel(detail.days_remaining), alert: detail.days_remaining < 0 },
        ].map((item) => (
          <div key={item.label} className="panel px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
              {item.label}
            </p>
            <p
              className={cn(
                "mt-1.5 text-[15px] font-medium",
                item.mono && "tnum",
                item.alert && "text-danger",
              )}
            >
              {item.value}
            </p>
          </div>
        ))}
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Record sections" />

      <div role="tabpanel" aria-label={tabs.find((item) => item.value === tab)?.label}>
        {tab === "overview" && <OverviewTab detail={detail} />}
        {tab === "documents" && (
          <DocumentsTab
            detail={detail}
            busy={busy}
            onUpload={() => openDialog({ type: "upload" })}
            onExtract={(documentId) => {
              void (async () => {
                setBusy(true);
                try {
                  await api.post<DocumentInfo>(`/documents/${documentId}/extract`);
                  await load();
                  toast.success("Extraction re-run. Review the extracted values.");
                } catch (caught) {
                  toast.error(
                    caught instanceof Error ? caught.message : "Extraction could not be run.",
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
            onReview={(extraction) => openDialog({ type: "review", extraction })}
          />
        )}
        {tab === "workflow" && <WorkflowTab detail={detail} />}
        {tab === "renewal" && (
          <RenewalTab detail={detail} onRenew={() => openDialog({ type: "renewal" })} />
        )}
        {tab === "audit" && <AuditTab detail={detail} />}
      </div>

      <ReasonDialog
        open={dialog?.type === "transition"}
        onClose={closeDialog}
        title={dialog?.type === "transition" ? dialog.label : "Update record"}
        description="The action is validated against the current state, your role and the record version."
        label="Reason"
        hint={
          dialog?.type === "transition" && dialog.requireReason
            ? "Required. Explain the decision; this is stored in the audit trail."
            : "Optional note for the record history."
        }
        requireReason={dialog?.type === "transition" ? dialog.requireReason : false}
        minLength={5}
        busy={busy}
        error={dialogError ?? undefined}
        confirmLabel="Confirm action"
        onSubmit={(reason) => {
          if (dialog?.type === "transition") void runTransition(dialog.action, reason);
        }}
      />

      {dialog?.type === "verification" && (
        <VerificationDialog
          detail={detail}
          busy={busy}
          error={dialogError}
          onClose={closeDialog}
          onError={setDialogError}
          onDone={async (message) => {
            await load();
            setDialog(null);
            toast.success(message);
          }}
        />
      )}

      {dialog?.type === "edit" && (
        <EditDialog
          detail={detail}
          busy={busy}
          error={dialogError}
          onClose={closeDialog}
          onError={setDialogError}
          onDone={async (updated) => {
            setDetail(updated);
            setDialog(null);
            toast.success("Record updated and audited.");
          }}
        />
      )}

      {dialog?.type === "upload" && (
        <UploadDialog
          detail={detail}
          busy={busy}
          error={dialogError}
          onClose={closeDialog}
          onError={setDialogError}
          onDone={async (document) => {
            await load();
            setDialog(null);
            toast.success(
              document.extraction_status === "EXTRACTED"
                ? "Document uploaded and text extracted. Review the compared values."
                : "Document uploaded. Extraction did not produce values; review manually.",
            );
          }}
        />
      )}

      <ReasonDialog
        open={dialog?.type === "release"}
        onClose={closeDialog}
        title="Request release"
        description="A release request records an authorization decision in this system only. No bank transfer or funds movement occurs."
        label="Reason for release"
        minLength={10}
        busy={busy}
        error={dialogError ?? undefined}
        confirmLabel="Submit release request"
        hint="At least 10 characters. A different approving officer must decide."
        onSubmit={(reason) => {
          void (async () => {
            if (!detail) return;
            setBusy(true);
            setDialogError(null);
            try {
              await api.post<ReleaseRequest>("/release-requests", {
                fdr_id: detail.id,
                request_reason: reason,
                expected_version: detail.version,
              });
              await load();
              setDialog(null);
              toast.success("Release request submitted. It now awaits an independent checker.");
            } catch (caught) {
              handleError(caught, "The release request could not be created.");
            } finally {
              setBusy(false);
            }
          })();
        }}
      />

      {dialog?.type === "decision" && (
        <ReleaseDecisionDialog
          request={dialog.request}
          currentUserId={user?.id ?? ""}
          onClose={closeDialog}
          onDecided={async (message) => {
            await load();
            setDialog(null);
            toast.success(message);
          }}
        />
      )}

      {dialog?.type === "renewal" && (
        <RenewalDialog
          detail={detail}
          busy={busy}
          error={dialogError}
          onClose={closeDialog}
          onError={setDialogError}
          onDone={async (successorId, reference) => {
            await load();
            setDialog(null);
            toast.success(`Renewal created as ${reference}. Previous record preserved.`);
            navigate(`/app/fdrs/${successorId}`);
          }}
        />
      )}

      {dialog?.type === "review" && (
        <ReviewExtractionDialog
          detail={detail}
          extraction={dialog.extraction}
          busy={busy}
          error={dialogError}
          onClose={closeDialog}
          onError={setDialogError}
          onDone={async (updated) => {
            setDetail(updated);
            setDialog(null);
            toast.success("Review outcome recorded.");
          }}
        />
      )}
    </div>
  );
}

function VerificationDialog({
  detail,
  busy,
  error,
  onClose,
  onError,
  onDone,
}: {
  detail: FdrDetail;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onError: (message: string | null) => void;
  onDone: (message: string) => Promise<void>;
}) {
  const [method, setMethod] = useState<"MANUAL" | "PROVIDER">("MANUAL");
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async () => {
    setWorking(true);
    onError(null);
    try {
      if (method === "MANUAL") {
        await api.post<FdrDetail>(`/fdrs/${detail.id}/transition`, {
          action: "VERIFY",
          reason: notes.trim(),
          expected_version: detail.version,
        });
        await onDone("Verification recorded. The record is now verified.");
      } else {
        const updated = await api.post<FdrDetail>(`/fdrs/${detail.id}/verification`, {
          method: "PROVIDER",
          notes: notes.trim() || null,
          evidence_reference: reference.trim() || null,
          expected_version: detail.version,
        });
        const latest = updated.verification_checks[0];
        await onDone(
          `Provider attempt recorded: ${latest?.result ?? "result stored"}. This does not verify the FDR.`,
        );
      }
    } catch (caught) {
      if (caught instanceof ApiError) {
        onError(caught.hint ? `${caught.message} ${caught.hint}` : caught.message);
      } else {
        onError("Verification could not be recorded.");
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Record verification"
      description="A manual confirmation reflects human review. No bank API is available in this prototype."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy || working}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy || working}
            onClick={() => void submit()}
            disabled={method === "MANUAL" && notes.trim().length < 5}
          >
            {method === "MANUAL" ? "Record manual verification" : "Attempt provider check"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <fieldset>
          <legend className="text-[13px] font-medium">Method</legend>
          <div className="mt-2 space-y-2">
            {[
              {
                value: "MANUAL" as const,
                title: "Manual review",
                text: "Confirm the submitted values against the evidence. Moves the record to Verified.",
              },
              {
                value: "PROVIDER" as const,
                title: "Attempt provider check",
                text: "Calls the configured adapter. With no bank provider this returns an error; simulation results are labelled and never confirm authenticity.",
              },
            ].map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-md border px-3 py-2.5",
                  method === option.value ? "border-primary bg-primary-soft/40" : "border-line",
                )}
              >
                <input
                  type="radio"
                  name="verification-method"
                  value={option.value}
                  checked={method === option.value}
                  onChange={() => setMethod(option.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-[13px] font-medium">{option.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted">{option.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <TextareaField
          id="verification-notes"
          label="What did you check?"
          rows={3}
          required={method === "MANUAL"}
          value={notes}
          maxLength={2000}
          onChange={(event) => setNotes(event.target.value)}
          hint={
            method === "MANUAL"
              ? "Required, at least 5 characters. Stored with the verification."
              : "Optional note stored with the attempt."
          }
        />
        <TextField
          id="verification-reference"
          label="Evidence reference (optional)"
          value={reference}
          maxLength={120}
          onChange={(event) => setReference(event.target.value)}
          hint="For example, a bank acknowledgement reference you hold offline. Do not paste secrets."
        />

        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Modal>
  );
}

function EditDialog({
  detail,
  busy,
  error,
  onClose,
  onError,
  onDone,
}: {
  detail: FdrDetail;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onError: (message: string | null) => void;
  onDone: (detail: FdrDetail) => Promise<void>;
}) {
  const [form, setForm] = useState({
    reference_number: detail.reference_number,
    bank_name: detail.bank_name,
    bank_code: detail.bank_code ?? "",
    amount: detail.amount,
    issue_date: detail.issue_date,
    maturity_date: detail.maturity_date,
    notes: detail.notes ?? "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    onError(null);
    setFieldErrors({});
    try {
      const updated = await api.patch<FdrDetail>(`/fdrs/${detail.id}`, {
        reference_number: form.reference_number.trim(),
        bank_name: form.bank_name.trim(),
        bank_code: form.bank_code.trim() || null,
        amount: form.amount.trim(),
        issue_date: form.issue_date,
        maturity_date: form.maturity_date,
        notes: form.notes.trim() || null,
        expected_version: detail.version,
      });
      await onDone(updated);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(Object.fromEntries(caught.fields.map((field) => [field.field, field.message])));
        onError(caught.message);
      } else {
        onError("The record could not be updated.");
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit submission"
      description="Edits are audited. Only drafts and correction-required records can be edited."
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy || working}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy || working}
            onClick={() => {
              const formElement = document.getElementById("edit-fdr-form") as HTMLFormElement | null;
              formElement?.requestSubmit();
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-fdr-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            id="edit-reference"
            label="FDR reference number"
            required
            value={form.reference_number}
            onChange={(event) => setForm({ ...form, reference_number: event.target.value })}
            error={fieldErrors.reference_number}
          />
          <TextField
            id="edit-bank"
            label="Issuing bank"
            required
            value={form.bank_name}
            onChange={(event) => setForm({ ...form, bank_name: event.target.value })}
            error={fieldErrors.bank_name}
          />
          <TextField
            id="edit-bank-code"
            label="Bank code"
            value={form.bank_code}
            onChange={(event) => setForm({ ...form, bank_code: event.target.value })}
          />
          <TextField
            id="edit-amount"
            label="Deposit amount (INR)"
            required
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
            error={fieldErrors.amount}
          />
          <TextField
            id="edit-issue"
            label="Issue date"
            type="date"
            required
            value={form.issue_date}
            onChange={(event) => setForm({ ...form, issue_date: event.target.value })}
            error={fieldErrors.issue_date}
          />
          <TextField
            id="edit-maturity"
            label="Maturity date"
            type="date"
            required
            value={form.maturity_date}
            onChange={(event) => setForm({ ...form, maturity_date: event.target.value })}
            error={fieldErrors.maturity_date}
          />
        </div>
        <TextareaField
          id="edit-notes"
          label="Notes for the reviewer"
          rows={3}
          value={form.notes}
          maxLength={2000}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />
      </form>
    </Modal>
  );
}

function UploadDialog({
  detail,
  busy,
  error,
  onClose,
  onError,
  onDone,
}: {
  detail: FdrDetail;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onError: (message: string | null) => void;
  onDone: (document: DocumentInfo) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    if (!file) {
      setLocalError("Choose a PDF, PNG or JPEG file.");
      return;
    }
    setWorking(true);
    onError(null);
    setLocalError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("document_type", "FDR_RECEIPT");
      const document = await api.upload<DocumentInfo>(`/fdrs/${detail.id}/documents`, form);
      await onDone(document);
    } catch (caught) {
      if (caught instanceof ApiError) {
        onError(caught.message);
      } else {
        onError("The document could not be uploaded.");
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Upload supporting document"
      description="Stored privately and only downloadable by authorised roles. Text extraction runs immediately."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy || working}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy || working} onClick={() => void submit()}>
            Upload document
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label htmlFor="upload-file" className="block text-[13px] font-medium">
          Document file
        </label>
        <input
          id="upload-file"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setLocalError(null);
          }}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-medium"
        />
        <p className="text-xs leading-5 text-muted">
          PDF, PNG or JPEG · up to 5 MB. Image OCR is unavailable in this environment; the file is
          stored but values must be reviewed manually.
        </p>
        {(localError || error) && (
          <InlineAlert tone="danger">{localError ?? error}</InlineAlert>
        )}
      </div>
    </Modal>
  );
}

function RenewalDialog({
  detail,
  busy,
  error,
  onClose,
  onError,
  onDone,
}: {
  detail: FdrDetail;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onError: (message: string | null) => void;
  onDone: (successorId: string, reference: string) => Promise<void>;
}) {
  const [relationship, setRelationship] = useState<"RENEWAL" | "REPLACEMENT">("RENEWAL");
  const [reason, setReason] = useState("");
  const [form, setForm] = useState({
    reference_number: "",
    bank_name: detail.bank_name,
    bank_code: detail.bank_code ?? "",
    amount: detail.amount,
    issue_date: localIsoDate(),
    maturity_date: localIsoDate(365),
  });
  const [working, setWorking] = useState(false);

  const submit = async () => {
    setWorking(true);
    onError(null);
    try {
      const response = await api.post<{
        successor_id: string;
        successor_reference: string;
      }>(`/fdrs/${detail.id}/renewals`, {
        relationship_type: relationship,
        reason: reason.trim(),
        new_fdr: {
          reference_number: form.reference_number.trim(),
          bank_name: form.bank_name.trim(),
          bank_code: form.bank_code.trim() || null,
          amount: form.amount.trim(),
          issue_date: form.issue_date,
          maturity_date: form.maturity_date,
        },
      });
      await onDone(response.successor_id, response.successor_reference);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : "The renewal could not be created.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Start renewal or replacement"
      description="Creates a linked successor record. This record keeps its own history and evidence."
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy || working}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy || working}
            disabled={reason.trim().length < 10 || form.reference_number.trim().length < 3}
            onClick={() => void submit()}
          >
            Create successor record
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            id="renewal-type"
            label="Relationship"
            value={relationship}
            onChange={(event) => setRelationship(event.target.value as "RENEWAL" | "REPLACEMENT")}
          >
            <option value="RENEWAL">Renewal</option>
            <option value="REPLACEMENT">Replacement</option>
          </SelectField>
          <TextField
            id="renewal-reference"
            label="New FDR reference"
            required
            value={form.reference_number}
            onChange={(event) => setForm({ ...form, reference_number: event.target.value })}
            maxLength={64}
          />
          <TextField
            id="renewal-bank"
            label="Issuing bank"
            required
            value={form.bank_name}
            onChange={(event) => setForm({ ...form, bank_name: event.target.value })}
          />
          <TextField
            id="renewal-bank-code"
            label="Bank code"
            value={form.bank_code}
            onChange={(event) => setForm({ ...form, bank_code: event.target.value })}
          />
          <TextField
            id="renewal-amount"
            label="Deposit amount (INR)"
            required
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
          <TextField
            id="renewal-issue"
            label="Issue date"
            type="date"
            required
            value={form.issue_date}
            onChange={(event) => setForm({ ...form, issue_date: event.target.value })}
          />
          <TextField
            id="renewal-maturity"
            label="Maturity date"
            type="date"
            required
            value={form.maturity_date}
            onChange={(event) => setForm({ ...form, maturity_date: event.target.value })}
          />
        </div>
        <TextareaField
          id="renewal-reason"
          label="Reason"
          rows={3}
          required
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint="At least 10 characters. Recorded against both records."
        />
        <InlineAlert tone="info">
          The successor starts as a submitted record with no evidence attached. Upload its synthetic
          receipt and have it reviewed before the predecessor closes as replaced.
        </InlineAlert>
      </div>
    </Modal>
  );
}

function ReviewExtractionDialog({
  detail,
  extraction,
  busy,
  error,
  onClose,
  onError,
  onDone,
}: {
  detail: FdrDetail;
  extraction: Extraction;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onError: (message: string | null) => void;
  onDone: (detail: FdrDetail) => Promise<void>;
}) {
  const [status, setStatus] = useState<"CONFIRMED" | "CORRECTED" | "DISMISSED">("CONFIRMED");
  const [corrected, setCorrected] = useState(extraction.extracted_value ?? "");
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);

  const submit = async () => {
    setWorking(true);
    onError(null);
    try {
      const updated = await api.post<FdrDetail>(`/fdrs/${detail.id}/extraction-review`, {
        reviews: [
          {
            extraction_id: extraction.id,
            review_status: status,
            corrected_value: status === "CORRECTED" ? corrected.trim() : null,
          },
        ],
        note: note.trim() || null,
      });
      await onDone(updated);
    } catch (caught) {
      onError(
        caught instanceof ApiError ? caught.message : "The review outcome could not be recorded.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Review extracted value"
      description="Record what the document actually says. This does not mark the FDR as verified."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy || working}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy || working}
            disabled={status === "CORRECTED" && corrected.trim().length === 0}
            onClick={() => void submit()}
          >
            Save review
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-line bg-canvas/50 px-3.5 py-3 text-sm">
          <p className="font-medium">{humanAction(extraction.field_name.replace(/_/g, " "))}</p>
          <p className="mt-1 text-xs text-muted">
            Extracted: <span className="tnum">{extraction.extracted_value ?? "—"}</span>
            {extraction.confidence !== null && ` · confidence ${extraction.confidence.toFixed(2)}`}
          </p>
        </div>

        <fieldset>
          <legend className="text-[13px] font-medium">Outcome</legend>
          <div className="mt-2 space-y-2">
            {[
              { value: "CONFIRMED" as const, title: "Confirm extracted value", text: "The document shows this value." },
              { value: "CORRECTED" as const, title: "Correct the value", text: "Record what the document actually shows." },
              { value: "DISMISSED" as const, title: "Dismiss", text: "Not a material field for this review." },
            ].map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-md border px-3 py-2.5",
                  status === option.value ? "border-primary bg-primary-soft/40" : "border-line",
                )}
              >
                <input
                  type="radio"
                  name="review-status"
                  checked={status === option.value}
                  onChange={() => setStatus(option.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-[13px] font-medium">{option.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted">{option.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {status === "CORRECTED" && (
          <TextField
            id="corrected-value"
            label="Corrected value"
            required
            value={corrected}
            onChange={(event) => setCorrected(event.target.value)}
            hint="Use the value printed on the document."
          />
        )}

        <TextareaField
          id="review-note"
          label="Note (optional)"
          rows={2}
          value={note}
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
        />

        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Modal>
  );
}
