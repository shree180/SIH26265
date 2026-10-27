import { Inbox, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ReleaseDecisionDialog } from "../components/ReleaseDecisionDialog";
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
import { formatDateTime, sentenceCase } from "../lib/format";
import type { Paginated, ReleaseRequest } from "../lib/types";

const STATUS_OPTIONS = [
  ["", "All requests"],
  ["PENDING_CHECKER", "Pending checker"],
  ["APPROVED", "Approved"],
  ["RETURNED", "Returned"],
  ["REJECTED", "Rejected"],
] as const;

function statusTone(status: ReleaseRequest["status"]) {
  if (status === "APPROVED") return "success" as const;
  if (status === "REJECTED") return "danger" as const;
  if (status === "RETURNED") return "warning" as const;
  return "info" as const;
}

export default function ReleaseRequestsPage() {
  const { user, capabilities } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const status = searchParams.get("status") ?? "";
  const search = searchParams.get("search") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [searchInput, setSearchInput] = useState(search);
  const [data, setData] = useState<Paginated<ReleaseRequest> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReleaseRequest | null>(null);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await api.get<Paginated<ReleaseRequest>>(
          `/release-requests${toQuery({ status, search, page, page_size: 20 })}`,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load release requests.");
    } finally {
      setLoading(false);
    }
  }, [status, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (changes: Record<string, string | undefined>, keepPage = false) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if (!keepPage) next.delete("page");
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Release requests</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          Maker-checker authorization for releasing a security deposit. Approving a request records a
          decision only; it does not move funds or contact a bank.
        </p>
      </header>

      <InlineAlert tone="info" title="Separation of duties">
        The institution raises the request (maker). A different authorised approving officer (checker)
        must decide it. The server rejects self-approval even if the interface is bypassed.
      </InlineAlert>

      <Panel bodyClassName="p-0">
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
          <form
            className="flex flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              update({ search: searchInput.trim() || undefined });
            }}
          >
            <label htmlFor="release-search" className="sr-only">
              Search release requests by FDR reference
            </label>
            <input
              id="release-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search FDR reference"
              className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-primary focus:outline-none"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
          <label htmlFor="release-status" className="sr-only">
            Request status
          </label>
          <select
            id="release-status"
            value={status}
            onChange={(event) => update({ status: event.target.value || undefined })}
            className="h-9 rounded-md border border-line bg-surface px-2.5 text-xs focus:border-primary focus:outline-none"
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={() => void load()} />
          </div>
        ) : loading && !data ? (
          <div className="p-4">
            <LoadingRows rows={6} label="Loading release requests" />
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={<Inbox size={20} aria-hidden />}
            title="No release requests"
            description={
              status === "PENDING_CHECKER"
                ? "No request is currently awaiting a checker decision."
                : "No release requests match this filter."
            }
          />
        ) : data ? (
          <>
            <TableShell caption="Release requests">
              <thead>
                <tr>
                  <th className={thClass}>Record</th>
                  {user?.role !== "INSTITUTION_ADMIN" && (
                    <th className={thClass}>Institution</th>
                  )}
                  <th className={thClass}>Maker</th>
                  <th className={thClass}>Requested</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Checker / decision</th>
                  <th className={thClass}>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((request) => {
                  const isMine = request.requested_by?.id === user?.id;
                  return (
                    <tr key={request.id} className="align-top hover:bg-canvas/60">
                      <td className={tdClass}>
                        <Link
                          to={`/app/fdrs/${request.fdr_id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {request.fdr_reference ?? "Record"}
                        </Link>
                        <p className="mt-1 max-w-[280px] text-[11px] leading-4 text-muted">
                          {request.request_reason}
                        </p>
                      </td>
                      {user?.role !== "INSTITUTION_ADMIN" && (
                        <td className={`${tdClass} text-xs text-muted`}>
                          {request.institution_name ?? "—"}
                        </td>
                      )}
                      <td className={tdClass}>
                        <p className="text-xs">{request.requested_by?.name ?? "—"}</p>
                        <p className="text-[11px] text-muted">
                          {request.requested_by?.email ?? ""}
                        </p>
                      </td>
                      <td className={`${tdClass} text-xs text-muted`}>
                        {formatDateTime(request.requested_at)}
                        {request.approval_overdue && (
                          <span className="mt-1 block">
                            <Badge tone="danger">Past SLA</Badge>
                          </span>
                        )}
                      </td>
                      <td className={tdClass}>
                        <Badge tone={statusTone(request.status)}>
                          {sentenceCase(request.status)}
                        </Badge>
                        {isMine && request.status === "PENDING_CHECKER" && (
                          <p className="mt-1 text-[10px] text-muted">Raised by you</p>
                        )}
                      </td>
                      <td className={tdClass}>
                        {request.checker ? (
                          <>
                            <p className="text-xs">{request.checker.name}</p>
                            <p className="mt-0.5 max-w-[240px] text-[11px] leading-4 text-muted">
                              {request.decision_reason}
                            </p>
                            <p className="text-[10px] text-muted">
                              {formatDateTime(request.decided_at)}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-muted">Awaiting decision</span>
                        )}
                      </td>
                      <td className={tdClass}>
                        {request.status === "PENDING_CHECKER" && capabilities?.can_decide_release && (
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={isMine}
                            title={
                              isMine
                                ? "Maker-checker separation prevents deciding your own request."
                                : undefined
                            }
                            onClick={() => setSelected(request)}
                            icon={<ShieldCheck size={13} aria-hidden />}
                          >
                            Decide
                          </Button>
                        )}
                        {request.status === "PENDING_CHECKER" && !capabilities?.can_decide_release && (
                          <span className="text-[11px] text-muted">
                            An approving officer decides this request.
                          </span>
                        )}
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
              onPage={(next) => update({ page: String(next) }, true)}
            />
          </>
        ) : null}
      </Panel>

      {selected && (
        <ReleaseDecisionDialog
          request={selected}
          currentUserId={user?.id ?? ""}
          onClose={() => setSelected(null)}
          onDecided={async (message) => {
            setSelected(null);
            await load();
            toast.success(message);
          }}
        />
      )}

      <p className="text-[11px] leading-5 text-muted">
        Approval marks the record released inside FDR Sentinel only. Releasing a security deposit in
        the real world requires the sponsoring organisation&apos;s own process and a verified banking
        channel.
      </p>
    </div>
  );
}
