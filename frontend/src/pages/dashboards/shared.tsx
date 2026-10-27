import { ArrowRight, Inbox, ListChecks } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge, DaysChip, EmptyState, PriorityBadge, StatCard, StatusBadge, TableShell, cn, tdClass, thClass } from "../../components/ui";
import { ROLE_LABELS, formatAmount, formatDate, formatDateTime } from "../../lib/format";
import type {
  FdrSummary,
  Priority,
  ReleaseQueueItem,
  Role,
  WorkspaceActionItem,
  WorkspaceTone,
} from "../../lib/types";

export function ageLabel(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** Shared heading for every role workspace: who you are, what this screen answers. */
export function WorkspaceHero({
  role,
  title,
  question,
  scopeLabel,
  businessDate,
  actions,
}: {
  role: Role;
  title: string;
  question: string;
  scopeLabel: string;
  businessDate: string;
  actions: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          {ROLE_LABELS[role]} · {scopeLabel}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{question}</p>
        <p className="mt-1 text-[11px] text-muted">Business date {formatDate(businessDate)}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
    </header>
  );
}

export function MetricGrid({
  items,
}: {
  items: {
    label: string;
    value: string | number;
    hint?: string;
    to?: string;
    tone?: WorkspaceTone;
  }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <StatCard key={item.label} {...item} />
      ))}
    </div>
  );
}

/** Priority-ordered records with their human-readable reasons. */
export function RecordsTable({
  records,
  caption,
  showInstitution = false,
  reasons,
  emptyTitle,
  emptyDescription,
}: {
  records: FdrSummary[];
  caption: string;
  showInstitution?: boolean;
  reasons?: Record<string, string[]>;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon={<ListChecks size={20} aria-hidden />}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }
  return (
    <TableShell caption={caption}>
      <thead>
        <tr>
          <th className={thClass}>Record</th>
          {showInstitution && <th className={thClass}>Institution</th>}
          <th className={thClass}>Status</th>
          <th className={thClass}>Maturity</th>
          <th className={thClass}>Priority</th>
          <th className={thClass}>
            <span className="sr-only">Open</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {records.map((record) => {
          const blocking = reasons?.[record.id] ?? [];
          return (
            <tr key={record.id} className="hover:bg-canvas/60">
              <td className={tdClass}>
                <Link
                  to={`/app/fdrs/${record.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {record.reference_number}
                </Link>
                <p className="mt-0.5 text-xs text-muted">
                  {record.bank_name} · {formatAmount(record.amount, record.currency)}
                </p>
              </td>
              {showInstitution && (
                <td className={tdClass}>
                  <span className="text-xs text-muted">
                    {record.institution?.name ?? "—"}
                  </span>
                </td>
              )}
              <td className={tdClass}>
                <StatusBadge status={record.lifecycle_status} />
                {!record.has_documents && (
                  <p className="mt-1 text-[11px] text-warning">No receipt attached</p>
                )}
              </td>
              <td className={tdClass}>
                <p className="whitespace-nowrap text-xs text-ink">
                  {formatDate(record.maturity_date)}
                </p>
                <div className="mt-1">
                  <DaysChip days={record.days_remaining} />
                </div>
              </td>
              <td className={tdClass}>
                <PriorityBadge priority={record.priority as Priority} />
                <p className="mt-1 max-w-[320px] text-[11px] leading-4 text-muted">
                  {blocking.length > 0
                    ? blocking.join(" · ")
                    : record.priority.factors.map((factor) => factor.label).join(" · ") ||
                      "No outstanding action"}
                </p>
              </td>
              <td className={tdClass}>
                <Link
                  to={`/app/fdrs/${record.id}`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

/** Release requests: what a checker (or an administrator reviewing the queue) needs. */
export function ReleaseQueueTable({
  items,
  caption,
  emptyTitle,
  emptyDescription,
  showDecision = false,
  showMaker = true,
}: {
  items: ReleaseQueueItem[];
  caption: string;
  emptyTitle: string;
  emptyDescription: string;
  showDecision?: boolean;
  showMaker?: boolean;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Inbox size={20} aria-hidden />}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }
  return (
    <TableShell caption={caption}>
      <thead>
        <tr>
          <th className={thClass}>Record</th>
          <th className={thClass}>Institution</th>
          <th className={thClass}>Amount</th>
          {showMaker && <th className={thClass}>Maker</th>}
          <th className={thClass}>Evidence</th>
          <th className={thClass}>{showDecision ? "Decided" : "Waiting / decided"}</th>
          <th className={thClass}>Status</th>
          <th className={thClass}>
            <span className="sr-only">Open</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const isDecided = item.status !== "PENDING_CHECKER";
          return (
          <tr key={item.id} className="hover:bg-canvas/60">
            <td className={tdClass}>
              <Link
                to={`/app/fdrs/${item.fdr_id}`}
                className="font-medium text-primary hover:underline"
              >
                {item.reference_number}
              </Link>
              <p className="mt-0.5 max-w-[280px] truncate text-[11px] text-muted">
                {item.request_reason}
              </p>
            </td>
            <td className={tdClass}>
              <span className="text-xs text-muted">{item.institution_name ?? "—"}</span>
            </td>
            <td className={cn(tdClass, "tnum whitespace-nowrap text-xs")}>
              {formatAmount(item.amount, item.currency)}
            </td>
            {showMaker && (
              <td className={tdClass}>
                <span className="text-xs text-ink">{item.maker_name}</span>
              </td>
            )}
            <td className={tdClass}>
              {item.document_count > 0 ? (
                <Badge tone="success">{item.document_count} file(s)</Badge>
              ) : (
                <Badge tone="warning">No evidence</Badge>
              )}
            </td>
            <td className={tdClass}>
              {isDecided ? (
                <>
                  <p className="whitespace-nowrap text-xs text-ink">
                    {formatDateTime(item.decided_at)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">Decided</p>
                </>
              ) : (
                <>
                  <p className="whitespace-nowrap text-xs text-ink">
                    {ageLabel(item.age_hours)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    Raised {formatDateTime(item.requested_at)}
                  </p>
                </>
              )}
            </td>
            <td className={tdClass}>
              <Badge
                tone={
                  item.status === "APPROVED"
                    ? "success"
                    : item.status === "REJECTED"
                      ? "danger"
                      : item.status === "RETURNED"
                        ? "warning"
                        : "info"
                }
              >
                {item.status_label}
              </Badge>
              {item.decision_reason && (
                <p className="mt-1 max-w-[280px] text-[11px] leading-4 text-muted">
                  {item.decision_reason}
                </p>
              )}
            </td>
            <td className={tdClass}>
              <Link
                to={`/app/fdrs/${item.fdr_id}`}
                className="text-xs font-medium text-primary hover:underline"
              >
                Review
              </Link>
            </td>
          </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

/** Counted, linked action rows used by the institution workspace. */
export function ActionList({ items }: { items: WorkspaceActionItem[] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) {
    return (
      <EmptyState
        icon={<ListChecks size={20} aria-hidden />}
        title="Nothing outstanding"
        description="No correction, missing receipt or unconfirmed extraction value was found for your institution."
      />
    );
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((item) => {
        const isClear = item.count === 0;
        return (
          <li key={item.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span
              className={cn(
                "tnum mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-semibold",
                isClear
                  ? "bg-canvas text-muted"
                  : item.tone === "danger"
                    ? "bg-danger/10 text-danger"
                    : item.tone === "warning"
                      ? "bg-warning/10 text-warning"
                      : "bg-primary-soft text-primary",
              )}
              aria-hidden
            >
              {item.count}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-[13px] font-medium", isClear && "text-muted")}>
                {item.label}
                <span className="sr-only">: {item.count} record(s)</span>
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted">{item.detail}</p>
            </div>
            <Link
              to={item.to}
              className={cn(
                "mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium",
                isClear ? "text-muted" : "text-primary hover:underline",
              )}
            >
              {isClear ? "View" : "Open"}
              <ArrowRight size={12} aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function WorkspaceNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] leading-5 text-muted">{children}</p>
  );
}
