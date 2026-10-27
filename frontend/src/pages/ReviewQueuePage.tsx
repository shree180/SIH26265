import { ClipboardCheck, Inbox } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  DaysChip,
  EmptyState,
  ErrorState,
  LoadingRows,
  Pagination,
  Panel,
  PriorityBadge,
  StatusBadge,
  TableShell,
  tdClass,
  thClass,
} from "../components/ui";
import { api, toQuery } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDate, formatDateTime } from "../lib/format";
import type { FdrSummary, Paginated } from "../lib/types";

export default function ReviewQueuePage() {
  const { user } = useAuth();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<FdrSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<FdrSummary>>(
        `/fdrs${toQuery({
          status: status || "SUBMITTED,UNDER_REVIEW",
          search,
          sort: "priority_desc",
          page,
          page_size: 20,
        })}`,
      );
      setData(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the review queue.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const isGlobal = user?.role !== "INSTITUTION_ADMIN";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          Submissions awaiting a reviewing officer. Priority ordering surfaces overdue reviews,
          document mismatches and upcoming maturities first.
        </p>
      </header>

      <Panel bodyClassName="p-0">
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
          <form
            className="flex flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchInput.trim());
            }}
          >
            <label htmlFor="review-search" className="sr-only">
              Search review queue
            </label>
            <input
              id="review-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search reference, bank or institution"
              className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-primary focus:outline-none"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
          <div className="flex items-center gap-2">
            <label htmlFor="review-status" className="sr-only">
              Review status
            </label>
            <select
              id="review-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="h-9 rounded-md border border-line bg-surface px-2.5 text-xs focus:border-primary focus:outline-none"
            >
              <option value="">All awaiting review</option>
              <option value="SUBMITTED">Submitted</option>
              <option value="UNDER_REVIEW">Under review</option>
            </select>
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
            <LoadingRows rows={6} label="Loading review queue" />
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={<Inbox size={20} aria-hidden />}
            title="Review queue is clear"
            description="No submissions are currently awaiting review for your scope."
          />
        ) : data ? (
          <>
            <TableShell caption="Submissions awaiting review">
              <thead>
                <tr>
                  <th className={thClass}>Record</th>
                  {isGlobal && <th className={thClass}>Institution</th>}
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Evidence</th>
                  <th className={thClass}>Maturity</th>
                  <th className={thClass}>Priority</th>
                  <th className={thClass}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-canvas/60">
                    <td className={tdClass}>
                      <Link
                        to={`/app/fdrs/${item.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {item.reference_number}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted">{item.bank_name}</p>
                      <p className="text-[11px] text-muted">
                        updated {formatDateTime(item.updated_at)}
                      </p>
                    </td>
                    {isGlobal && (
                      <td className={`${tdClass} text-xs text-muted`}>
                        {item.institution?.name ?? "—"}
                      </td>
                    )}
                    <td className={tdClass}>
                      <StatusBadge status={item.lifecycle_status} />
                    </td>
                    <td className={tdClass}>
                      <div className="flex flex-col gap-1">
                        <Badge tone={item.has_documents ? "neutral" : "warning"}>
                          {item.has_documents
                            ? `${item.document_count} document${item.document_count === 1 ? "" : "s"}`
                            : "No document"}
                        </Badge>
                        {item.unresolved_discrepancies > 0 && (
                          <Badge tone="danger">
                            {item.unresolved_discrepancies} field
                            {item.unresolved_discrepancies === 1 ? "" : "s"} need review
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className={tdClass}>
                      <p className="whitespace-nowrap text-xs">{formatDate(item.maturity_date)}</p>
                      <div className="mt-1">
                        <DaysChip days={item.days_remaining} />
                      </div>
                    </td>
                    <td className={tdClass}>
                      <PriorityBadge priority={item.priority} />
                      <p className="mt-1 max-w-[260px] text-[11px] leading-4 text-muted">
                        {item.priority.factors.map((factor) => factor.label).join(" · ") ||
                          "No outstanding action"}
                      </p>
                    </td>
                    <td className={tdClass}>
                      <Link
                        to={`/app/fdrs/${item.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <ClipboardCheck size={13} aria-hidden /> Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            <Pagination
              page={data.page}
              pages={data.pages}
              total={data.total}
              pageSize={data.page_size}
              busy={loading}
              onPage={setPage}
            />
          </>
        ) : null}
      </Panel>

      <p className="text-[11px] leading-5 text-muted">
        Every decision records an actor, reason and timestamp in the hash-chained audit trail.
        Records under review longer than the configured SLA carry an additional priority reason.
      </p>
    </div>
  );
}
