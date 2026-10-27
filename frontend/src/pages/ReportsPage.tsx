import { Download, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  InlineAlert,
  Panel,
  TableShell,
  tdClass,
  thClass,
} from "../components/ui";
import { api, downloadCsv, toQuery } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime } from "../lib/format";
import type { AuditEvent, FdrSummary, Paginated } from "../lib/types";

const STATUS_OPTIONS = [
  ["", "Any status"],
  ["SUBMITTED,UNDER_REVIEW", "Pending review"],
  ["ACTIVE,MATURING", "Active or maturing"],
  ["CORRECTION_REQUIRED", "Correction required"],
  ["PENDING_CHECKER", "Pending checker"],
  ["RELEASED", "Released"],
  ["REPLACED", "Replaced"],
  ["REJECTED", "Rejected"],
] as const;

const MATURITY_OPTIONS = [
  ["", "Any maturity"],
  ["overdue", "Overdue"],
  ["7", "Within 7 days"],
  ["15", "Within 15 days"],
  ["30", "Within 30 days"],
  ["90", "Within 90 days"],
] as const;

const COLUMNS = [
  "Reference",
  "Institution",
  "Institution code",
  "Bank",
  "Bank code",
  "Amount",
  "Currency",
  "Issue date",
  "Maturity date",
  "Days remaining",
  "Lifecycle status",
  "Verification status",
  "Priority score",
  "Priority reasons",
  "Documents",
  "Unresolved discrepancies",
  "Created at",
];

export default function ReportsPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [maturity, setMaturity] = useState("");
  const [discrepancy, setDiscrepancy] = useState("");
  const [verificationStatus, setVerificationStatus] = useState("");
  const [matching, setMatching] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exports, setExports] = useState<AuditEvent[]>([]);
  const [exportsError, setExportsError] = useState<string | null>(null);

  const filters = {
    search: search.trim(),
    status,
    maturity,
    discrepancy,
    verification_status: verificationStatus,
  };

  const loadExports = useCallback(async () => {
    try {
      const response = await api.get<Paginated<AuditEvent>>(
        "/audit-events?action=EXPORT_FDRS&page_size=5",
      );
      setExports(response.items);
      setExportsError(null);
    } catch (caught) {
      setExportsError(caught instanceof Error ? caught.message : "Could not load export history.");
    }
  }, []);

  useEffect(() => {
    void loadExports();
  }, [loadExports]);

  useEffect(() => {
    let cancelled = false;
    setCounting(true);
    api
      .get<Paginated<FdrSummary>>(`/fdrs${toQuery({ ...filters, page_size: 1 })}`)
      .then((response) => {
        if (!cancelled) setMatching(response.total);
      })
      .catch(() => {
        if (!cancelled) setMatching(null);
      })
      .finally(() => {
        if (!cancelled) setCounting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, maturity, discrepancy, verificationStatus]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const result = await downloadCsv("/reports/fdrs.csv", filters);
      toast.success(
        `Exported ${result.rows} record${result.rows === 1 ? "" : "s"}${
          result.truncated ? " (capped at 5,000 rows)" : ""
        }. The export was audited.`,
      );
      await loadExports();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const clear = () => {
    setSearch("");
    setStatus("");
    setMaturity("");
    setDiscrepancy("");
    setVerificationStatus("");
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          Export the records your role can see, with the current filters applied. Exports are
          server-side, scoped, and recorded in the audit trail.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Panel title="Export filters" description="Filters apply to both the count and the CSV.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="report-search" className="mb-1.5 block text-[13px] font-medium">
                  Search
                </label>
                <input
                  id="report-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Reference, bank or institution"
                  className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="report-status" className="mb-1.5 block text-[13px] font-medium">
                  Lifecycle status
                </label>
                <select
                  id="report-status"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm focus:border-primary focus:outline-none"
                >
                  {STATUS_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="report-maturity" className="mb-1.5 block text-[13px] font-medium">
                  Maturity
                </label>
                <select
                  id="report-maturity"
                  value={maturity}
                  onChange={(event) => setMaturity(event.target.value)}
                  className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm focus:border-primary focus:outline-none"
                >
                  {MATURITY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="report-discrepancy" className="mb-1.5 block text-[13px] font-medium">
                  Document review
                </label>
                <select
                  id="report-discrepancy"
                  value={discrepancy}
                  onChange={(event) => setDiscrepancy(event.target.value)}
                  className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="">Any</option>
                  <option value="with">Needs document review</option>
                  <option value="without">No open discrepancy</option>
                </select>
              </div>
              <div>
                <label htmlFor="report-verification" className="mb-1.5 block text-[13px] font-medium">
                  Verification
                </label>
                <select
                  id="report-verification"
                  value={verificationStatus}
                  onChange={(event) => setVerificationStatus(event.target.value)}
                  className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="">Any</option>
                  <option value="UNVERIFIED">Unverified</option>
                  <option value="MANUAL_CONFIRMED">Manually confirmed</option>
                  <option value="SIMULATION_ONLY">Simulation only</option>
                </select>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <Button
                variant="primary"
                loading={exporting}
                onClick={() => void exportCsv()}
                icon={<Download size={15} aria-hidden />}
              >
                Export CSV
              </Button>
              <Button variant="ghost" onClick={clear}>
                Clear filters
              </Button>
              <span className="ml-auto text-xs text-muted">
                {counting
                  ? "Counting matching records…"
                  : matching === null
                    ? "Record count unavailable"
                    : `${matching} matching record${matching === 1 ? "" : "s"}`}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { label: "All records", apply: clear },
                {
                  label: "Overdue",
                  apply: () => {
                    clear();
                    setMaturity("overdue");
                  },
                },
                {
                  label: "Pending review",
                  apply: () => {
                    clear();
                    setStatus("SUBMITTED,UNDER_REVIEW");
                  },
                },
                {
                  label: "Needs document review",
                  apply: () => {
                    clear();
                    setDiscrepancy("with");
                  },
                },
              ].map((preset) => (
                <Button key={preset.label} size="sm" variant="secondary" onClick={preset.apply}>
                  {preset.label}
                </Button>
              ))}
            </div>
          </Panel>

          <Panel
            title="Export history"
            description="Recent CSV exports from the audit trail."
            bodyClassName="p-0"
          >
            {exportsError ? (
              <p className="px-4 py-4 text-sm text-muted">{exportsError}</p>
            ) : exports.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">
                No exports recorded for your scope yet.
              </p>
            ) : (
              <TableShell caption="Recent exports">
                <thead>
                  <tr>
                    <th className={thClass}>When</th>
                    <th className={thClass}>Actor</th>
                    <th className={thClass}>Rows</th>
                    <th className={thClass}>Filters</th>
                  </tr>
                </thead>
                <tbody>
                  {exports.map((event) => {
                    const payload = event.payload as {
                      row_count?: number;
                      truncated?: boolean;
                      filters?: Record<string, string | null>;
                    };
                    const active = Object.entries(payload.filters ?? {})
                      .filter(([, value]) => value)
                      .map(([key, value]) => `${key}: ${value}`);
                    return (
                      <tr key={event.id}>
                        <td className={`${tdClass} whitespace-nowrap text-xs text-muted`}>
                          {formatDateTime(event.occurred_at)}
                        </td>
                        <td className={`${tdClass} text-xs`}>{event.actor_label}</td>
                        <td className={`${tdClass} tnum text-xs`}>
                          {payload.row_count ?? "—"}
                          {payload.truncated && (
                            <Badge tone="warning" className="ml-1">
                              capped
                            </Badge>
                          )}
                        </td>
                        <td className={`${tdClass} text-[11px] text-muted`}>
                          {active.length > 0 ? active.join(" · ") : "No filters"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableShell>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Included columns" description="A stable, documented column set.">
            <ol className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-2">
              {COLUMNS.map((column, index) => (
                <li key={column} className="flex gap-2">
                  <span className="tnum w-4 shrink-0 text-right text-[10px] text-muted/70">
                    {index + 1}
                  </span>
                  <span>{column}</span>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Export safeguards">
            <ul className="space-y-2.5 text-xs leading-5 text-muted">
              <li className="flex gap-2">
                <FileSpreadsheet size={14} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                Server-side, filtered and scoped to {user?.institution?.name ?? "your permitted records"}.
              </li>
              <li className="flex gap-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                Cells beginning with =, +, - or @ are prefixed so spreadsheets never evaluate them
                as formulas.
              </li>
              <li className="flex gap-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" aria-hidden />
                Every export is written to the audit trail with its row count and filters.
              </li>
            </ul>
            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-5 text-muted">
              Exports are capped at 5,000 rows per request for this prototype. PDF reports, scheduled
              delivery and bulk import are not implemented.
            </p>
          </Panel>

          <InlineAlert tone="info" title="Priority reasons are included">
            The CSV carries the priority score and human-readable reasons so a reviewer can see why a
            record was ordered as it was. Priority is not a risk determination.
          </InlineAlert>
        </div>
      </div>
    </div>
  );
}
