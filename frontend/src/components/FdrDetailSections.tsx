import {
  ArrowUpRight,
  BadgeCheck,
  Download,
  FileWarning,
  History,
  Link2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  Badge,
  DiscrepancyBadge,
  DetailGrid,
  EmptyState,
  InlineAlert,
  Panel,
  PriorityBadge,
  ProvenanceStrip,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
} from "./ui";
import { Button } from "./ui";
import {
  daysLabel,
  fileSize,
  formatAmount,
  formatDate,
  formatDateTime,
  humanAction,
  sentenceCase,
  shortHash,
} from "../lib/format";
import type { Discrepancy, DocumentInfo, Extraction, FdrDetail } from "../lib/types";

function extractionSummary(documents: DocumentInfo[]) {
  if (documents.length === 0) {
    return { value: "No document", tone: "warning" as const, note: "Evidence not uploaded." };
  }
  if (documents.some((document) => document.extraction_status === "EXTRACTED")) {
    const fields = documents.reduce(
      (total, document) => total + (document.extractions?.length ?? 0),
      0,
    );
    return {
      value: "Text extracted",
      tone: "info" as const,
      note: `${fields} field${fields === 1 ? "" : "s"} read from the PDF text layer. Not OCR.`,
    };
  }
  if (documents.some((document) => document.extraction_status === "UNAVAILABLE")) {
    return {
      value: "Not extracted",
      tone: "warning" as const,
      note: "No OCR engine configured; values must be entered and reviewed manually.",
    };
  }
  if (documents.some((document) => document.extraction_status === "NO_TEXT_LAYER")) {
    return {
      value: "No text layer",
      tone: "warning" as const,
      note: "The PDF appears to be a scan and no OCR engine is installed.",
    };
  }
  return {
    value: "Pending",
    tone: "neutral" as const,
    note: "Extraction has not produced values yet.",
  };
}

function reviewedCount(detail: FdrDetail): number {
  return detail.documents.reduce(
    (total, document) =>
      total + document.extractions.filter((item) => item.review_status !== "PENDING").length,
    0,
  );
}

export function Provenance({ detail }: { detail: FdrDetail }) {
  const extraction = extractionSummary(detail.documents);
  const simulated = detail.verification_checks.some((check) => check.simulated);
  const reviewed = reviewedCount(detail);
  const manual =
    detail.verification_status === "MANUAL_CONFIRMED" || reviewed > 0
      ? {
          value: detail.verification_status === "MANUAL_CONFIRMED" ? "Manually confirmed" : "Reviewed",
          tone: "success" as const,
          note:
            detail.verification_status === "MANUAL_CONFIRMED"
              ? "A reviewer confirmed the evidence manually."
              : `${reviewed} extracted field${reviewed === 1 ? "" : "s"} reviewed.`,
        }
      : { value: "Not reviewed", tone: "neutral" as const, note: "No manual review recorded." };

  return (
    <ProvenanceStrip
      items={[
        {
          label: "Submitted by institution",
          value: detail.submitted_at ? "Submitted" : detail.lifecycle_status === "DRAFT" ? "Draft" : "Record",
          tone: detail.submitted_at ? "info" : "neutral",
          note: detail.submitted_at
            ? `Submitted ${formatDateTime(detail.submitted_at)}`
            : "Not yet submitted for review.",
        },
        {
          label: "Automated extraction",
          value: extraction.value,
          tone: extraction.tone,
          note: extraction.note,
        },
        { label: "Manually reviewed", ...manual },
        {
          label: "Independently confirmed",
          value: simulated ? "Simulation only" : "Not available",
          tone: simulated ? "warning" : "neutral",
          note: simulated
            ? "A simulated provider result is recorded. It is NOT a bank confirmation."
            : "No authorised bank or data-source integration is configured.",
        },
      ]}
    />
  );
}

export function PriorityPanel({ detail }: { detail: FdrDetail }) {
  return (
    <Panel
      title="Explainable priority"
      description="Deterministic rule score. It orders work; it never approves, rejects or releases a record."
      actions={<PriorityBadge priority={detail.priority} />}
    >
      <p className="text-sm leading-6 text-ink">{detail.priority.summary}</p>
      {detail.priority.factors.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          No outstanding action detected in the current rules.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {detail.priority.factors.map((factor) => (
            <li key={factor.code} className="flex items-start justify-between gap-4 py-2">
              <div>
                <p className="text-[13px] text-ink">{factor.label}</p>
                <p className="text-[11px] text-muted">{factor.detail}</p>
              </div>
              <span className="tnum shrink-0 text-xs font-medium text-muted">+{factor.weight}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 border-t border-line pt-3 text-[11px] leading-5 text-muted">
        Rule version {detail.priority.rule_version}. Weights are prototype design values, not an
        official AICTE or sponsor risk model. Only the highest applicable maturity threshold is
        applied.
      </p>
    </Panel>
  );
}

export function DiscrepancyTable({ fields }: { fields: Discrepancy[] }) {
  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted">
        No comparison available. Upload a document and run extraction to compare values.
      </p>
    );
  }
  return (
    <TableShell caption="Submitted versus extracted values">
      <thead>
        <tr>
          <th className={thClass}>Field</th>
          <th className={thClass}>Submitted</th>
          <th className={thClass}>Extracted</th>
          <th className={thClass}>Confidence</th>
          <th className={thClass}>Status</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((field) => (
          <tr key={field.field}>
            <td className="border-b border-line/70 px-4 py-3 text-[12px] font-medium text-ink">
              {field.label}
            </td>
            <td className={`${tdClass} tnum text-xs`}>{field.submitted_value}</td>
            <td className={`${tdClass} tnum text-xs`}>
              {field.extracted_value ?? "—"}
              {field.corrected_value && (
                <span className="mt-0.5 block text-[11px] text-muted">
                  corrected: {field.corrected_value}
                </span>
              )}
            </td>
            <td className={`${tdClass} text-xs text-muted`}>
              {field.confidence === null ? "Not reported" : field.confidence.toFixed(2)}
            </td>
            <td className={tdClass}>
              <DiscrepancyBadge status={field.status} />
              {field.note && (
                <p className="mt-1 max-w-[260px] text-[11px] leading-4 text-muted">{field.note}</p>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function OverviewTab({ detail }: { detail: FdrDetail }) {
  const tenureDays = Math.max(
    0,
    Math.round(
      (new Date(detail.maturity_date).getTime() - new Date(detail.issue_date).getTime()) /
        86_400_000,
    ),
  );

  return (
    <div className="space-y-5">
      <Panel title="Record summary">
        <div className="space-y-5">
          <Provenance detail={detail} />
          <DetailGrid
            items={[
              { label: "Institution", value: detail.institution?.name ?? "—" },
              { label: "Issuing bank", value: detail.bank_name },
              { label: "Bank code", value: detail.bank_code ?? "—" },
              { label: "Deposit amount", value: <span className="tnum">{formatAmount(detail.amount, detail.currency)}</span> },
              { label: "Issue date", value: formatDate(detail.issue_date) },
              {
                label: "Maturity date",
                value: (
                  <span>
                    {formatDate(detail.maturity_date)}{" "}
                    <span className="text-xs text-muted">({daysLabel(detail.days_remaining)})</span>
                  </span>
                ),
              },
              { label: "Tenure", value: `${tenureDays} days` },
              { label: "Created by", value: detail.created_by?.name ?? "—" },
              { label: "Created at", value: formatDateTime(detail.created_at) },
              { label: "Submitted", value: formatDateTime(detail.submitted_at) },
              { label: "Verified", value: formatDateTime(detail.verified_at) },
              { label: "Activated", value: formatDateTime(detail.activated_at) },
              { label: "Released", value: formatDateTime(detail.released_at) },
              { label: "Released by", value: detail.released_by ?? "—" },
              { label: "Record version", value: <span className="tnum">v{detail.version}</span> },
            ]}
          />
          {detail.notes && (
            <div className="rounded-md border border-line bg-canvas/50 px-3.5 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                Institution notes
              </p>
              <p className="mt-1 whitespace-pre-line text-sm leading-6">{detail.notes}</p>
            </div>
          )}
        </div>
      </Panel>

      <PriorityPanel detail={detail} />

      <Panel
        title="Submitted vs extracted"
        description="Extraction is a candidate value. Review each discrepancy before relying on it."
      >
        <DiscrepancyTable fields={detail.discrepancies} />
      </Panel>

      <Panel title="Verification history" description="Manual checks and any provider attempts.">
        {detail.verification_checks.length === 0 ? (
          <p className="text-sm text-muted">No verification recorded yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {detail.verification_checks.map((check) => (
              <li key={check.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={check.method === "MANUAL" ? "success" : "warning"}>
                    {check.method === "MANUAL" ? "Manual review" : "Provider attempt"}
                  </Badge>
                  <span className="text-[13px] font-medium">{check.result}</span>
                  {check.simulated && <Badge tone="warning">SIMULATED — not a bank confirmation</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {check.provider} · {formatDateTime(check.checked_at)}
                  {check.checked_by ? ` · ${check.checked_by}` : ""}
                  {check.evidence_reference ? ` · ref ${check.evidence_reference}` : ""}
                </p>
                {check.notes && (
                  <p className="mt-1 text-xs leading-5 text-muted">{check.notes}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {detail.release_requests.length > 0 && (
        <Panel
          title="Release requests"
          description="Records a decision only. No bank transfer or funds movement occurs."
          actions={
            <Link
              to="/app/release-requests"
              className="text-xs font-medium text-primary hover:underline"
            >
              Open queue
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {detail.release_requests.map((request) => (
              <li key={request.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      request.status === "APPROVED"
                        ? "success"
                        : request.status === "REJECTED"
                          ? "danger"
                          : request.status === "RETURNED"
                            ? "warning"
                            : "info"
                    }
                  >
                    {sentenceCase(request.status)}
                  </Badge>
                  <span className="text-[13px] text-ink">
                    Raised by {request.requested_by?.name ?? "—"} ·{" "}
                    {formatDateTime(request.requested_at)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted">{request.request_reason}</p>
                {request.decision_reason && (
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Decision by {request.checker?.name ?? "—"}: {request.decision_reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

export function DocumentsTab({
  detail,
  busy,
  onUpload,
  onExtract,
  onReview,
}: {
  detail: FdrDetail;
  busy: boolean;
  onUpload: () => void;
  onExtract: (documentId: string) => void;
  onReview: (extraction: Extraction) => void;
}) {
  return (
    <div className="space-y-5">
      {!detail.has_documents && (
        <InlineAlert tone="warning" title="No supporting document">
          The record has no evidence attached. A reviewer may require correction before it can be
          verified.
        </InlineAlert>
      )}

      <Panel
        title="Documents"
        description="Stored privately. Downloads are authorized per record and never public."
        actions={
          detail.permissions.can_upload_document ? (
            <Button size="sm" variant="secondary" onClick={onUpload} icon={<Download size={14} aria-hidden className="rotate-180" />}>
              Upload document
            </Button>
          ) : undefined
        }
        bodyClassName="p-0"
      >
        {detail.documents.length === 0 ? (
          <EmptyState
            icon={<FileWarning size={20} aria-hidden />}
            title="No documents yet"
            description={
              detail.permissions.can_upload_document
                ? "Upload the synthetic FDR receipt while the record is a draft or awaiting correction."
                : "No evidence was uploaded for this record."
            }
            action={
              detail.permissions.can_upload_document ? (
                <Button variant="secondary" onClick={onUpload}>
                  Upload document
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {detail.documents.map((document) => (
              <li key={document.id} className="px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {document.original_filename}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {fileSize(document.size_bytes)} · {document.content_type} ·{" "}
                      {document.document_type} · uploaded {formatDateTime(document.uploaded_at)}
                    </p>
                    <p className="mt-1 break-all font-mono text-[10px] text-muted">
                      sha256 {document.sha256_digest}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone="neutral" icon={<ShieldCheck size={12} aria-hidden />}>
                        Private storage
                      </Badge>
                      <Badge tone="warning">
                        Scan: {document.scan_status === "NOT_SCANNED" ? "not scanned" : document.scan_status}
                      </Badge>
                      <Badge
                        tone={
                          document.extraction_status === "EXTRACTED"
                            ? "info"
                            : document.extraction_status === "FAILED"
                              ? "danger"
                              : "warning"
                        }
                      >
                        Extraction: {sentenceCase(document.extraction_status)}
                      </Badge>
                      {document.extraction_engine && (
                        <span className="text-[11px] text-muted">{document.extraction_engine}</span>
                      )}
                    </div>
                    {document.extraction_note && (
                      <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">
                        {document.extraction_note}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <a
                      href={document.download_url}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[13px] font-medium text-ink hover:bg-canvas"
                    >
                      <Download size={14} aria-hidden />
                      Download
                    </a>
                    {detail.permissions.can_extract && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onExtract(document.id)}
                        loading={busy}
                        icon={<RefreshCw size={14} aria-hidden />}
                      >
                        Run extraction
                      </Button>
                    )}
                  </div>
                </div>

                {document.extractions.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-md border border-line">
                    <TableShell caption={`Extracted fields for ${document.original_filename}`}>
                      <thead>
                        <tr>
                          <th className={thClass}>Field</th>
                          <th className={thClass}>Extracted value</th>
                          <th className={thClass}>Review</th>
                          <th className={thClass}>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {document.extractions.map((extraction) => (
                          <tr key={extraction.id}>
                            <td className={tdClass}>
                              <span className="text-xs font-medium">
                                {sentenceCase(extraction.field_name)}
                              </span>
                            </td>
                            <td className={`${tdClass} tnum text-xs`}>
                              {extraction.corrected_value ?? extraction.extracted_value ?? "—"}
                              {extraction.corrected_value && (
                                <span className="mt-0.5 block text-[10px] text-muted">
                                  extracted: {extraction.extracted_value}
                                </span>
                              )}
                            </td>
                            <td className={tdClass}>
                              <Badge
                                tone={
                                  extraction.review_status === "PENDING"
                                    ? "warning"
                                    : extraction.review_status === "DISMISSED"
                                      ? "neutral"
                                      : "success"
                                }
                              >
                                {sentenceCase(extraction.review_status)}
                              </Badge>
                            </td>
                            <td className={tdClass}>
                              {detail.permissions.can_review_extractions &&
                                extraction.review_status === "PENDING" && (
                                  <Button size="sm" variant="ghost" onClick={() => onReview(extraction)}>
                                    Review
                                  </Button>
                                )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </TableShell>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export function WorkflowTab({ detail }: { detail: FdrDetail }) {
  return (
    <Panel
      title="Workflow history"
      description="Every lifecycle action, actor and reason. Newest last."
      bodyClassName="p-0"
    >
      {detail.workflow_events.length === 0 ? (
        <EmptyState title="No workflow events" description="No transitions have been recorded." />
      ) : (
        <ol className="divide-y divide-line">
          {detail.workflow_events.map((event) => (
            <li key={event.id} className="px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{humanAction(event.action)}</span>
                {event.to_state && <StatusBadge status={event.to_state} />}
                <span className="text-[11px] text-muted">{formatDateTime(event.created_at)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {event.actor_label}
                {event.from_state && event.to_state
                  ? ` · ${sentenceCase(event.from_state)} → ${sentenceCase(event.to_state)}`
                  : ""}
              </p>
              {event.reason && (
                <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">“{event.reason}”</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function RenewalTab({ detail, onRenew }: { detail: FdrDetail; onRenew: () => void }) {
  const { predecessor, successors } = detail.renewal;
  return (
    <div className="space-y-5">
      <Panel
        title="Renewal and replacement history"
        description="Linked records are preserved. Previous instruments are never overwritten."
        actions={
          detail.permissions.can_renew ? (
            <Button size="sm" variant="secondary" onClick={onRenew} icon={<Link2 size={14} aria-hidden />}>
              Start renewal
            </Button>
          ) : undefined
        }
      >
        {!predecessor && successors.length === 0 ? (
          <EmptyState
            icon={<History size={20} aria-hidden />}
            title="No renewal history"
            description="This record has not been renewed, replaced, or linked to another instrument."
          />
        ) : (
          <div className="space-y-4">
            {predecessor && (
              <div className="rounded-md border border-line bg-canvas/40 px-3.5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                  Predecessor ({sentenceCase(predecessor.relationship_type)})
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Link
                    to={`/app/fdrs/${predecessor.id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    {predecessor.reference_number}
                  </Link>
                  <StatusBadge status={predecessor.lifecycle_status} />
                  <span className="text-[11px] text-muted">
                    linked {formatDateTime(predecessor.created_at)}
                  </span>
                </div>
              </div>
            )}

            {successors.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
                  Successor records
                </p>
                <ul className="mt-2 divide-y divide-line border-y border-line">
                  {successors.map((successor) => (
                    <li
                      key={successor.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/app/fdrs/${successor.id}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          {successor.reference_number}
                        </Link>
                        <StatusBadge status={successor.lifecycle_status} />
                        <Badge tone="neutral">{sentenceCase(successor.relationship_type)}</Badge>
                      </div>
                      <span className="text-[11px] text-muted">
                        {formatDateTime(successor.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>

      <InlineAlert tone="info" title="How linking works">
        Starting a renewal creates a new submitted record linked to this one. This record is marked
        renewal pending, and closes as replaced once the successor is verified. Both records remain
        readable with their own evidence and audit history.
      </InlineAlert>
    </div>
  );
}

export function AuditTab({ detail }: { detail: FdrDetail }) {
  return (
    <div className="space-y-4">
      <Panel
        title="Audit trail"
        description="Hash-chained events for this record. Newest first."
        actions={
          <Link to="/app/audit" className="text-xs font-medium text-primary hover:underline">
            Verify chain <ArrowUpRight size={12} aria-hidden className="ml-0.5 inline" />
          </Link>
        }
        bodyClassName="p-0"
      >
        {detail.audit_events.length === 0 ? (
          <EmptyState title="No audit events" description="No material actions recorded yet." />
        ) : (
          <TableShell caption="Audit events for this record">
            <thead>
              <tr>
                <th className={thClass}>Seq</th>
                <th className={thClass}>Action</th>
                <th className={thClass}>Actor</th>
                <th className={thClass}>When</th>
                <th className={thClass}>Event hash</th>
              </tr>
            </thead>
            <tbody>
              {detail.audit_events.map((event) => (
                <tr key={event.id} className="align-top">
                  <td className={`${tdClass} tnum text-xs text-muted`}>{event.sequence}</td>
                  <td className={tdClass}>
                    <p className="text-xs font-medium">{humanAction(event.action)}</p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] text-primary">
                        Payload
                      </summary>
                      <pre className="mt-1 max-w-[320px] overflow-x-auto rounded bg-canvas p-2 text-[10px] leading-4 text-muted">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </details>
                  </td>
                  <td className={`${tdClass} text-xs text-muted`}>{event.actor_label}</td>
                  <td className={`${tdClass} text-xs text-muted`}>
                    {formatDateTime(event.occurred_at)}
                  </td>
                  <td className={`${tdClass} font-mono text-[10px] text-muted`}>
                    <span title={event.event_hash}>{shortHash(event.event_hash)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Panel>

      <InlineAlert tone="warning" title="What hash chaining proves">
        Each event hashes the previous hash plus its canonical data, so edits to the recorded history
        can be detected. It is not immutability: an actor able to rewrite every event and the chain
        head could rebuild a consistent chain. Database privileges and independent checkpoints are
        required for stronger guarantees.
      </InlineAlert>
    </div>
  );
}

export function VerificationStatusNote({ detail }: { detail: FdrDetail }) {
  if (detail.verification_status === "SIMULATION_ONLY") {
    return (
      <InlineAlert tone="warning" title="Simulation only">
        The latest verification attempt used a simulated adapter. This is not a bank confirmation
        and does not satisfy the manual verification requirement for a release request.
      </InlineAlert>
    );
  }
  if (detail.verification_status === "MANUAL_CONFIRMED") {
    return (
      <InlineAlert tone="success" title="Manually confirmed">
        A reviewing officer recorded a manual confirmation. This reflects human review of the
        submitted evidence, not independent bank confirmation.
      </InlineAlert>
    );
  }
  return null;
}

export function DocumentExtractionHint() {
  return (
    <div className="flex items-start gap-2 text-[11px] leading-5 text-muted">
      <BadgeCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
      Extracted values are candidates, not confirmed facts. Confidence is shown only when the engine
      reports it.
    </div>
  );
}
