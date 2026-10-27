import { BellRing, CalendarClock, Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  DaysChip,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingRows,
  Pagination,
  Panel,
  PriorityBadge,
  StatusBadge,
  TableShell,
  Tabs,
  tdClass,
  thClass,
} from "../components/ui";
import { api, toQuery } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDate, formatDateTime } from "../lib/format";
import type {
  DashboardSummary,
  FdrSummary,
  NotificationItem,
  NotificationList,
  Paginated,
} from "../lib/types";

type WindowKey = "overdue" | "7" | "15" | "30" | "all";

export default function MaturityPage() {
  const { user, setUnreadNotifications, unreadNotifications } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const windowKey = (searchParams.get("window") as WindowKey | null) ?? "30";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [data, setData] = useState<Paginated<FdrSummary> | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [alerts, setAlerts] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listing = await api.get<Paginated<FdrSummary>>(
        `/fdrs${toQuery({
          maturity: windowKey === "all" ? undefined : windowKey,
          sort: "maturity_asc",
          page,
          page_size: 20,
        })}`,
      );
      setData(listing);
      const [dashboard, notifications] = await Promise.all([
        api.get<DashboardSummary>("/dashboard/summary"),
        api.get<NotificationList>("/notifications?limit=20"),
      ]);
      setSummary(dashboard);
      setAlerts(notifications.items);
      setUnreadNotifications(notifications.unread_count);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load maturity data.");
    } finally {
      setLoading(false);
    }
  }, [windowKey, page, setUnreadNotifications]);

  useEffect(() => {
    void load();
  }, [load]);

  const setWindow = (next: WindowKey) => {
    const params = new URLSearchParams(searchParams);
    if (next === "30") params.delete("window");
    else params.set("window", next);
    params.delete("page");
    setSearchParams(params, { replace: true });
  };

  const acknowledge = async (item: NotificationItem) => {
    setAcknowledging(item.id);
    try {
      await api.post<NotificationItem>(`/notifications/${item.id}/acknowledge`);
      setAlerts((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, acknowledged_at: new Date().toISOString() } : entry,
        ),
      );
      setUnreadNotifications(Math.max(0, unreadNotifications - 1));
      toast.success("Alert acknowledged. Acknowledging does not complete the renewal or release.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Could not acknowledge the alert.");
    } finally {
      setAcknowledging(null);
    }
  };

  const buckets = summary?.maturity_buckets ?? [];
  const tabs: { value: WindowKey; label: string; count?: number }[] = [
    {
      value: "overdue",
      label: "Overdue",
      count: buckets.find((bucket) => bucket.key === "OVERDUE")?.count,
    },
    { value: "7", label: "≤ 7 days", count: buckets.find((b) => b.key === "WITHIN_7")?.count },
    { value: "15", label: "≤ 15 days", count: buckets.find((b) => b.key === "WITHIN_15")?.count },
    { value: "30", label: "≤ 30 days", count: buckets.find((b) => b.key === "WITHIN_30")?.count },
    { value: "all", label: "All records" },
  ];

  const isGlobal = user?.role !== "INSTITUTION_ADMIN";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Maturity &amp; alerts</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
          Deposits approaching or past maturity, evaluated in the configured business timezone.
          Alerts are generated once per threshold and never complete an action on their own.
        </p>
      </header>

      <Tabs tabs={tabs} value={windowKey} onChange={setWindow} label="Maturity window" />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          title={
            windowKey === "all"
              ? "All records by maturity"
              : windowKey === "overdue"
                ? "Overdue deposits"
                : `Maturing within ${windowKey} days`
          }
          description="Open a record to confirm the next action."
          bodyClassName="p-0"
        >
          {error ? (
            <div className="p-4">
              <ErrorState message={error} onRetry={() => void load()} />
            </div>
          ) : loading && !data ? (
            <div className="p-4">
              <LoadingRows rows={6} label="Loading maturity queue" />
            </div>
          ) : data && data.items.length === 0 ? (
            <EmptyState
              icon={<CalendarClock size={20} aria-hidden />}
              title="Nothing in this window"
              description="No records in your scope match this maturity window."
            />
          ) : data ? (
            <>
              <TableShell caption="Maturity queue">
                <thead>
                  <tr>
                    <th className={thClass}>Record</th>
                    {isGlobal && <th className={thClass}>Institution</th>}
                    <th className={thClass}>Maturity</th>
                    <th className={thClass}>Status</th>
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
                        <p className="mt-0.5 text-xs text-muted">{item.bank_name}</p>
                      </td>
                      {isGlobal && (
                        <td className={`${tdClass} text-xs text-muted`}>
                          {item.institution?.name ?? "—"}
                        </td>
                      )}
                      <td className={tdClass}>
                        <p className="whitespace-nowrap text-xs">{formatDate(item.maturity_date)}</p>
                        <div className="mt-1">
                          <DaysChip days={item.days_remaining} />
                        </div>
                      </td>
                      <td className={tdClass}>
                        <StatusBadge status={item.lifecycle_status} />
                      </td>
                      <td className={tdClass}>
                        <Badge tone={item.has_documents ? "neutral" : "warning"}>
                          {item.has_documents ? `${item.document_count} doc(s)` : "Missing"}
                        </Badge>
                      </td>
                      <td className={tdClass}>
                        <PriorityBadge priority={item.priority} />
                        <p className="mt-1 max-w-[230px] text-[11px] leading-4 text-muted">
                          {item.priority.factors.map((factor) => factor.label).join(" · ") ||
                            "No outstanding action"}
                        </p>
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
                onPage={(next) => {
                  const params = new URLSearchParams(searchParams);
                  params.set("page", String(next));
                  setSearchParams(params, { replace: true });
                }}
              />
            </>
          ) : null}
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Maturity alerts"
            description="One alert per threshold per record per recipient."
            actions={<Badge tone="neutral">{alerts.filter((item) => !item.acknowledged_at).length} unread</Badge>}
          >
            {alerts.length === 0 ? (
              <div className="space-y-2 text-sm text-muted">
                <p className="flex items-center gap-2 font-medium text-ink">
                  <BellRing size={16} aria-hidden /> No alerts for your account
                </p>
                <p className="text-xs leading-5">
                  Alerts are delivered in-app to institution administrators for their own records.
                  Reviewers and approvers see the same maturity risk through this queue.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {alerts.map((item) => (
                  <li key={item.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        to={`/app/fdrs/${item.fdr_id}`}
                        className="text-[13px] font-medium text-primary hover:underline"
                      >
                        {item.fdr_reference ?? "Record"}
                      </Link>
                      <Badge tone={item.alert_type === "MATURITY_OVERDUE" ? "danger" : "warning"}>
                        {item.alert_type === "MATURITY_OVERDUE"
                          ? "Overdue"
                          : `${item.threshold_days} days`}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted">{item.message}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-muted">
                        {formatDateTime(item.created_at)}
                      </span>
                      {item.acknowledged_at ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-success">
                          <Check size={12} aria-hidden /> Acknowledged
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={acknowledging === item.id}
                          onClick={() => void acknowledge(item)}
                        >
                          Acknowledge
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <InlineAlert tone="info" title="Alert policy">
            Alerts fire at any configured 30, 15 and 7 day threshold and once when overdue. Repeated
            scheduler runs never duplicate a logical alert. Acknowledging an alert does not renew,
            replace or release the deposit, and no email or SMS delivery is configured.
          </InlineAlert>
        </div>
      </div>
    </div>
  );
}
