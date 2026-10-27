import { ChevronDown, History, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingRows,
  Pagination,
  Panel,
  TableShell,
  tdClass,
  thClass,
} from "../components/ui";
import { api, toQuery } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime, humanAction, shortHash } from "../lib/format";
import type { AuditChainResult, AuditEvent, Paginated } from "../lib/types";

const ACTIONS = [
  "FDR_CREATED",
  "FDR_UPDATED",
  "FDR_TRANSITION",
  "DOCUMENT_UPLOADED",
  "DOCUMENT_EXTRACTED",
  "EXTRACTION_REVIEWED",
  "VERIFICATION_RECORDED",
  "RELEASE_REQUESTED",
  "RELEASE_DECISION",
  "RENEWAL_CREATED",
  "EXPORT_FDRS",
  "ALERT_ACKNOWLEDGED",
  "USER_SIGNED_IN",
  "USER_SIGNED_OUT",
  "USER_UPDATED",
  "INSTITUTION_CREATED",
  "INSTITUTION_UPDATED",
  "MATURITY_SCAN_RUN",
  "AUDIT_CHAIN_VERIFIED",
] as const;

const ENTITY_TYPES = ["FDR", "USER", "INSTITUTION", "EXPORT", "SYSTEM"] as const;

function entityLink(event: AuditEvent) {
  if (event.entity_type === "FDR") return `/app/fdrs/${event.entity_id}`;
  return null;
}

function PayloadCell({ event }: { event: AuditEvent }) {
  const entries = Object.entries(event.payload ?? {});
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-primary">
        <ChevronDown
          size={12}
          aria-hidden
          className="transition-transform group-open:rotate-180"
        />
        {entries.length === 0 ? "No fields" : `${entries.length} field${entries.length === 1 ? "" : "s"}`}
      </summary>
      <dl className="mt-2 max-w-[420px] space-y-1 rounded-md border border-line bg-canvas px-2.5 py-2 text-[11px] leading-4">
        {entries.length === 0 ? (
          <p className="text-muted">This event carries no structured payload.</p>
        ) : (
          entries.map(([key, value]) => (
            <div key={key} className="flex flex-wrap gap-1">
              <dt className="font-medium text-muted">{key}:</dt>
              <dd className="break-all text-ink">
                {typeof value === "object" && value !== null
                  ? JSON.stringify(value)
                  : String(value)}
              </dd>
            </div>
          ))
        )}
      </dl>
    </details>
  );
}

export default function AuditPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const action = searchParams.get("action") ?? "";
  const entityType = searchParams.get("entity_type") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [data, setData] = useState<Paginated<AuditEvent> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<AuditChainResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const canVerify = user?.role === "AUDITOR" || user?.role === "SYSTEM_ADMIN";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.get<Paginated<AuditEvent>>(
          `/audit-events${toQuery({ action, entity_type: entityType, page, page_size: 25 })}`,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the audit trail.");
    } finally {
      setLoading(false);
    }
  }, [action, entityType, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    setSearchParams(next, { replace: true });
  };

  const verify = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const result = await api.post<AuditChainResult>("/admin/audit/verify-chain");
      setVerification(result);
      if (result.valid) {
        toast.success(`Audit chain verified across ${result.checked} events.`);
      } else {
        toast.error("The audit chain is broken. Review the flagged event before relying on it.");
      }
      await load();
    } catch (caught) {
      setVerifyError(caught instanceof Error ? caught.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit trail</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          Append-only history of protected actions, scoped to what your role may see. Each entry
          chains to the previous entry by hash so edits can be detected.
        </p>
      </header>

      <Panel
        title="Integrity check"
        description="Recomputes the hash chain across every stored event."
        actions={
          canVerify ? (
            <Button
              variant="primary"
              loading={verifying}
              onClick={() => void verify()}
              icon={<ShieldCheck size={15} aria-hidden />}
            >
              Verify chain
            </Button>
          ) : (
            <Badge tone="neutral">Auditor or administrator</Badge>
          )
        }
      >
        {verifyError && (
          <div className="mb-3">
            <InlineAlert tone="danger" title="Verification could not run">
              {verifyError}
            </InlineAlert>
          </div>
        )}
        {verification ? (
          <div className="space-y-3">
            <InlineAlert
              tone={verification.valid ? "success" : "danger"}
              title={verification.valid ? "Hash chain intact" : "Hash chain broken"}
            >
              {verification.valid ? (
                <>
                  All {verification.checked} events verified
                  {verification.chain_head
                    ? `; head ${shortHash(verification.chain_head, 16)}`
                    : ""}
                  . Checked {formatDateTime(verification.checked_at)}.
                </>
              ) : (
                <>
                  Verification failed at sequence {verification.broken_sequence ?? "unknown"}:
                  {" "}
                  {verification.reason ?? "hash mismatch"}. Treat affected records as untrusted until
                  investigated.
                </>
              )}
            </InlineAlert>
            <p className="text-[11px] leading-5 text-muted">{verification.limitation}</p>
          </div>
        ) : (
          <div className="space-y-2 text-sm leading-6 text-muted">
            <p>
              Verification recomputes each event&apos;s SHA-256 digest from its stored fields and the
              previous hash. A mismatch means a stored row changed after it was written.
            </p>
            <p className="text-[11px] leading-5">
              {canVerify
                ? "Each verification attempt is itself written to the audit trail."
                : "Only an auditor or system administrator can run this check. Everything below is read-only."}
            </p>
          </div>
        )}
      </Panel>

      <Panel bodyClassName="p-0">
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row">
            <div>
              <label htmlFor="audit-action" className="sr-only">
                Filter by action
              </label>
              <select
                id="audit-action"
                value={action}
                onChange={(event) => update({ action: event.target.value || undefined })}
                className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-xs focus:border-primary focus:outline-none sm:w-[220px]"
              >
                <option value="">All actions</option>
                {ACTIONS.map((value) => (
                  <option key={value} value={value}>
                    {humanAction(value)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="audit-entity" className="sr-only">
                Filter by entity type
              </label>
              <select
                id="audit-entity"
                value={entityType}
                onChange={(event) => update({ entity_type: event.target.value || undefined })}
                className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-xs focus:border-primary focus:outline-none sm:w-[170px]"
              >
                <option value="">All entity types</option>
                {ENTITY_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(action || entityType) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}
              >
                Clear filters
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading}>
              Refresh
            </Button>
          </div>
        </div>

        {error ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={() => void load()} />
          </div>
        ) : loading && !data ? (
          <div className="p-4">
            <LoadingRows rows={8} label="Loading audit trail" />
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={<History size={20} aria-hidden />}
            title="No audit events"
            description="No recorded events match these filters within your permitted scope."
          />
        ) : data ? (
          <>
            <TableShell caption="Audit events">
              <thead>
                <tr>
                  <th className={thClass}>Seq</th>
                  <th className={thClass}>When</th>
                  <th className={thClass}>Actor</th>
                  <th className={thClass}>Action</th>
                  <th className={thClass}>Entity</th>
                  <th className={thClass}>Details</th>
                  <th className={thClass}>Hash</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((event) => {
                  const link = entityLink(event);
                  return (
                    <tr key={event.id} className="align-top">
                      <td className={`${tdClass} tnum text-xs text-muted`}>{event.sequence}</td>
                      <td className={`${tdClass} whitespace-nowrap text-xs text-muted`}>
                        {formatDateTime(event.occurred_at)}
                      </td>
                      <td className={`${tdClass} text-xs`}>{event.actor_label}</td>
                      <td className={tdClass}>
                        <span className="text-[13px] font-medium">{humanAction(event.action)}</span>
                        <p className="mt-0.5 font-mono text-[10px] uppercase text-muted">
                          {event.action}
                        </p>
                      </td>
                      <td className={`${tdClass} text-xs`}>
                        <span className="text-[10px] uppercase tracking-wide text-muted">
                          {event.entity_type}
                        </span>
                        <p className="mt-0.5">
                          {link ? (
                            <Link to={link} className="font-medium text-primary hover:underline">
                              {event.entity_label ?? event.entity_id}
                            </Link>
                          ) : (
                            <span>{event.entity_label ?? event.entity_id}</span>
                          )}
                        </p>
                      </td>
                      <td className={tdClass}>
                        <PayloadCell event={event} />
                      </td>
                      <td className={`${tdClass} font-mono text-[10px] text-muted`}>
                        <span title={event.event_hash}>{shortHash(event.event_hash)}</span>
                        <p className="mt-0.5" title={event.previous_hash}>
                          prev {shortHash(event.previous_hash, 8)}
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableShell>
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              pageSize={data.page_size}
              busy={loading}
              onPage={(next) => {
                const params = new URLSearchParams(searchParams);
                params.set("page", String(next));
                setSearchParams(params, { replace: true });
              }}
            />
          </>
        ) : null}
      </Panel>

      <p className="text-[11px] leading-5 text-muted">
        The chain is a tamper-evidence mechanism for this database, not an external notarisation or
        blockchain. An operator with full database control could rewrite the whole chain; export or
        independently anchor the chain head if that threat matters.
      </p>
    </div>
  );
}
