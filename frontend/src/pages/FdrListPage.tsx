import { Download, FileWarning, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  DaysChip,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingRows,
  Pagination,
  Panel,
  PriorityBadge,
  StatusBadge,
  TableShell,
  VerificationBadge,
  tdClass,
  thClass,
} from "../components/ui";
import { api, downloadCsv, toQuery } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatAmount, formatDate } from "../lib/format";
import type { FdrSummary, Institution, Paginated } from "../lib/types";

const STATUS_OPTIONS = [
  ["DRAFT", "Draft"],
  ["SUBMITTED", "Submitted"],
  ["UNDER_REVIEW", "Under review"],
  ["CORRECTION_REQUIRED", "Correction required"],
  ["VERIFIED", "Verified"],
  ["ACTIVE", "Active"],
  ["MATURING", "Maturing"],
  ["RENEWAL_PENDING", "Renewal pending"],
  ["PENDING_CHECKER", "Pending checker"],
  ["RELEASED", "Released"],
  ["REPLACED", "Replaced"],
  ["REJECTED", "Rejected"],
  ["EXPIRED", "Expired"],
] as const;

const PAGE_SIZE = 20;

export default function FdrListPage() {
  const { user, capabilities } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? "";
  const verificationStatus = searchParams.get("verification_status") ?? "";
  const institutionId = searchParams.get("institution_id") ?? "";
  const maturity = searchParams.get("maturity") ?? "";
  const discrepancy = searchParams.get("discrepancy") ?? "";
  const sort = searchParams.get("sort") ?? "maturity_asc";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [searchInput, setSearchInput] = useState(search);
  const [data, setData] = useState<Paginated<FdrSummary> | null>(null);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGlobal = Boolean(user && user.role !== "INSTITUTION_ADMIN");

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    if (!isGlobal) return;
    api
      .get<{ items: Institution[] }>("/institutions")
      .then((response) => setInstitutions(response.items))
      .catch(() => setInstitutions([]));
  }, [isGlobal]);

  const query = {
    search,
    status,
    verification_status: verificationStatus,
    institution_id: institutionId,
    maturity,
    discrepancy,
    sort,
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<Paginated<FdrSummary>>(
        `/fdrs${toQuery({ ...query, page, page_size: PAGE_SIZE })}`,
      );
      setData(response);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load FDR records.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, verificationStatus, institutionId, maturity, discrepancy, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (changes: Record<string, string | undefined>, keepPage = false) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (!keepPage) next.delete("page");
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true });

  const activeFilters = [
    search,
    status,
    verificationStatus,
    institutionId,
    maturity,
    discrepancy,
    sort !== "maturity_asc" ? sort : "",
  ].filter(Boolean).length;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const result = await downloadCsv("/reports/fdrs.csv", query);
      toast.success(
        `Exported ${result.rows} record${result.rows === 1 ? "" : "s"}${
          result.truncated ? " (capped at 5,000 rows)" : ""
        }. The export was recorded in the audit trail.`,
      );
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">FDR records</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            {isGlobal
              ? "All institutions in scope. Search, filter and open a record to review evidence."
              : "Your institution's records, evidence and current lifecycle status."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            loading={exporting}
            onClick={() => void exportCsv()}
            icon={<Download size={15} aria-hidden />}
          >
            Export CSV
          </Button>
          {capabilities?.can_submit && (
            <LinkButton to="/app/fdrs/new" icon={<Plus size={15} aria-hidden />}>
              New FDR
            </LinkButton>
          )}
        </div>
      </header>

      <Panel bodyClassName="p-0">
        <div className="space-y-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <form
              className="flex flex-1 gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                update({ search: searchInput.trim() || undefined });
              }}
            >
              <label htmlFor="fdr-search" className="sr-only">
                Search by reference number, bank or institution
              </label>
              <div className="relative flex-1">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                  aria-hidden
                />
                <input
                  id="fdr-search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search reference, bank or institution"
                  className="h-9 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-muted/70 focus:border-primary focus:outline-none"
                />
              </div>
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters ({activeFilters})
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <div>
              <label htmlFor="filter-status" className="sr-only">
                Lifecycle status
              </label>
              <select
                id="filter-status"
                value={status}
                onChange={(event) => update({ status: event.target.value || undefined })}
                className="h-8 w-full rounded-md border border-line bg-surface px-2 text-xs text-ink focus:border-primary focus:outline-none"
              >
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="filter-verification" className="sr-only">
                Verification status
              </label>
              <select
                id="filter-verification"
                value={verificationStatus}
                onChange={(event) =>
                  update({ verification_status: event.target.value || undefined })
                }
                className="h-8 w-full rounded-md border border-line bg-surface px-2 text-xs text-ink focus:border-primary focus:outline-none"
              >
                <option value="">Any verification</option>
                <option value="UNVERIFIED">Unverified</option>
                <option value="MANUAL_CONFIRMED">Manually confirmed</option>
                <option value="SIMULATION_ONLY">Simulation only</option>
                <option value="MISMATCH_REPORTED">Mismatch reported</option>
                <option value="FAILED_VERIFICATION">Verification failed</option>
              </select>
            </div>

            <div>
              <label htmlFor="filter-maturity" className="sr-only">
                Maturity window
              </label>
              <select
                id="filter-maturity"
                value={maturity}
                onChange={(event) => update({ maturity: event.target.value || undefined })}
                className="h-8 w-full rounded-md border border-line bg-surface px-2 text-xs text-ink focus:border-primary focus:outline-none"
              >
                <option value="">Any maturity</option>
                <option value="overdue">Overdue</option>
                <option value="7">Within 7 days</option>
                <option value="15">Within 15 days</option>
                <option value="30">Within 30 days</option>
                <option value="90">Within 90 days</option>
                <option value="upcoming">Upcoming</option>
              </select>
            </div>

            <div>
              <label htmlFor="filter-discrepancy" className="sr-only">
                Document discrepancies
              </label>
              <select
                id="filter-discrepancy"
                value={discrepancy}
                onChange={(event) => update({ discrepancy: event.target.value || undefined })}
                className="h-8 w-full rounded-md border border-line bg-surface px-2 text-xs text-ink focus:border-primary focus:outline-none"
              >
                <option value="">Any discrepancy state</option>
                <option value="with">Needs document review</option>
                <option value="without">No open discrepancy</option>
              </select>
            </div>

            {isGlobal && (
              <div>
                <label htmlFor="filter-institution" className="sr-only">
                  Institution
                </label>
                <select
                  id="filter-institution"
                  value={institutionId}
                  onChange={(event) =>
                    update({ institution_id: event.target.value || undefined })
                  }
                  className="h-8 w-full rounded-md border border-line bg-surface px-2 text-xs text-ink focus:border-primary focus:outline-none"
                >
                  <option value="">All institutions</option>
                  {institutions.map((institution) => (
                    <option key={institution.id} value={institution.id}>
                      {institution.institution_code}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="filter-sort" className="sr-only">
                Sort order
              </label>
              <select
                id="filter-sort"
                value={sort}
                onChange={(event) =>
                  update({ sort: event.target.value === "maturity_asc" ? undefined : event.target.value })
                }
                className="h-8 w-full rounded-md border border-line bg-surface px-2 text-xs text-ink focus:border-primary focus:outline-none"
              >
                <option value="maturity_asc">Soonest maturity</option>
                <option value="maturity_desc">Latest maturity</option>
                <option value="priority_desc">Highest priority</option>
                <option value="amount_desc">Largest amount</option>
                <option value="created_desc">Newest first</option>
                <option value="status">Status</option>
              </select>
            </div>
          </div>
        </div>

        {error ? (
          <div className="p-4">
            <ErrorState message={error} onRetry={() => void load()} />
          </div>
        ) : loading && !data ? (
          <div className="p-4">
            <LoadingRows rows={6} label="Loading records" />
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={<SlidersHorizontal size={20} aria-hidden />}
            title={activeFilters ? "No records match these filters" : "No FDR records yet"}
            description={
              activeFilters
                ? "Adjust or clear the filters to widen the result set."
                : capabilities?.can_submit
                  ? "Submit the first security deposit record to start the review workflow."
                  : "No records are visible for your role and scope."
            }
            action={
              activeFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : capabilities?.can_submit ? (
                <LinkButton to="/app/fdrs/new" icon={<Plus size={15} aria-hidden />}>
                  Submit FDR
                </LinkButton>
              ) : undefined
            }
          />
        ) : data ? (
          <>
            <TableShell caption="FDR records">
              <thead>
                <tr>
                  <th className={thClass}>Reference</th>
                  {isGlobal && <th className={thClass}>Institution</th>}
                  <th className={thClass}>Amount</th>
                  <th className={thClass}>Maturity</th>
                  <th className={thClass}>Status</th>
                  <th className={`${thClass} hidden lg:table-cell`}>Verification</th>
                  <th className={thClass}>Evidence</th>
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
                      <p className="mt-0.5 max-w-[220px] truncate text-xs text-muted">
                        {item.bank_name}
                      </p>
                    </td>
                    {isGlobal && (
                      <td className={tdClass}>
                        <p className="max-w-[170px] truncate text-xs text-ink">
                          {item.institution?.name ?? "—"}
                        </p>
                        <p className="text-[11px] text-muted">
                          {item.institution?.institution_code}
                        </p>
                      </td>
                    )}
                    <td className={`${tdClass} tnum whitespace-nowrap`}>
                      {formatAmount(item.amount, item.currency)}
                    </td>
                    <td className={tdClass}>
                      <p className="whitespace-nowrap text-xs">{formatDate(item.maturity_date)}</p>
                      <div className="mt-1">
                        <DaysChip days={item.days_remaining} />
                      </div>
                    </td>
                    <td className={tdClass}>
                      <StatusBadge status={item.lifecycle_status} />
                      <p className="mt-1 text-[11px] text-muted">
                        Updated {formatDate(item.updated_at)}
                      </p>
                    </td>
                    <td className={`${tdClass} hidden lg:table-cell`}>
                      <VerificationBadge status={item.verification_status} />
                    </td>
                    <td className={tdClass}>
                      {item.has_documents ? (
                        <div className="space-y-1">
                          <Badge tone="neutral">
                            {item.document_count} doc{item.document_count === 1 ? "" : "s"}
                          </Badge>
                          {item.unresolved_discrepancies > 0 && (
                            <Badge tone="danger">
                              <FileWarning size={12} aria-hidden />
                              {item.unresolved_discrepancies} to review
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <Badge tone="warning">
                          <FileWarning size={12} aria-hidden />
                          Missing
                        </Badge>
                      )}
                    </td>
                    <td className={tdClass}>
                      <PriorityBadge priority={item.priority} />
                    </td>
                    <td className={tdClass}>
                      <Link
                        to={`/app/fdrs/${item.id}`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Open
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
              onPage={(next) => update({ page: String(next) }, true)}
            />
          </>
        ) : null}
      </Panel>

      {data?.computed_in_memory && (
        <p className="text-[11px] leading-5 text-muted">
          Priority ordering and discrepancy filters are calculated across the first 2,000 matching
          scoped records for this prototype.
        </p>
      )}
    </div>
  );
}
