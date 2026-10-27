import { Activity, Database, PlayCircle, ShieldAlert, ShieldCheck, UsersRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../../components/Toast";
import {
  Badge,
  Button,
  InlineAlert,
  LinkButton,
  Panel,
  ProvenanceStrip,
  TableShell,
  tdClass,
  thClass,
} from "../../components/ui";
import { api } from "../../lib/api";
import { ROLE_LABELS, formatDateTime, humanAction } from "../../lib/format";
import type {
  AuditChainResult,
  DashboardSummary,
  MaturityScanResult,
  SystemAdminWorkspace,
} from "../../lib/types";
import { MetricGrid, ReleaseQueueTable, WorkspaceHero, WorkspaceNote } from "./shared";

/** Is the platform operating safely, and is access configured correctly. */
export default function SystemAdminDashboard({
  summary,
  workspace,
}: {
  summary: DashboardSummary;
  workspace: SystemAdminWorkspace;
}) {
  const toast = useToast();
  const [scan, setScan] = useState<MaturityScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [chain, setChain] = useState<AuditChainResult | null>(null);
  const [checking, setChecking] = useState(false);

  const runScan = async () => {
    setScanning(true);
    try {
      const result = await api.post<MaturityScanResult>("/admin/jobs/maturity-scan");
      setScan(result);
      toast.success(
        `Scan complete: ${result.alerts_created} new alert(s), ${result.alerts_existing} already present.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The maturity scan failed.");
    } finally {
      setScanning(false);
    }
  };

  const runChainCheck = async () => {
    setChecking(true);
    try {
      const result = await api.post<AuditChainResult>("/admin/audit/verify-chain");
      setChain(result);
      if (result.valid) {
        toast.success(`Chain verified across ${result.checked} event(s).`);
      } else {
        toast.error(`Chain problem at sequence ${result.broken_sequence ?? "unknown"}.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The integrity check failed.");
    } finally {
      setChecking(false);
    }
  };

  const { accounts, scheduler, delivery, extraction } = workspace;
  const lastRunValues = scheduler.last_run as Record<string, number | string | undefined>;

  return (
    <div className="rise space-y-6">
      <WorkspaceHero
        role={workspace.role}
        title={workspace.title}
        question={workspace.question}
        scopeLabel="Platform-wide"
        businessDate={summary.business_date}
        actions={
          <>
            <Button
              variant="primary"
              loading={scanning}
              onClick={() => void runScan()}
              icon={<PlayCircle size={15} aria-hidden />}
            >
              Run maturity scan
            </Button>
            <Button
              variant="secondary"
              loading={checking}
              onClick={() => void runChainCheck()}
              icon={<ShieldCheck size={15} aria-hidden />}
            >
              Verify audit chain
            </Button>
            <LinkButton
              to="/app/admin/users"
              variant="secondary"
              icon={<UsersRound size={15} aria-hidden />}
            >
              Manage users
            </LinkButton>
          </>
        }
      />

      <MetricGrid
        items={[
          {
            label: "Accounts",
            value: accounts.total,
            to: "/app/admin/users",
            hint: `${accounts.active} active, ${accounts.inactive} inactive`,
          },
          { label: "Active sessions", value: accounts.active_sessions },
          {
            label: "Locked or throttled",
            value: accounts.locked_or_throttled,
            tone: accounts.locked_or_throttled > 0 ? "warning" : "neutral",
            hint: "Accounts with a recorded lockout",
          },
          {
            label: "Awaiting a checker",
            value: summary.metrics.pending_release_approvals,
            to: "/app/release-requests?status=PENDING_CHECKER",
          },
          {
            label: "Records in scope",
            value: workspace.records_in_scope,
            to: "/app/fdrs",
          },
          {
            label: "Receipts unreadable",
            value: extraction.unavailable,
            tone: extraction.unavailable > 0 ? "warning" : "neutral",
            hint: "No usable text layer; manual entry required",
          },
          {
            label: "Alerts undelivered",
            value: delivery.failed,
            tone: delivery.failed > 0 ? "danger" : "neutral",
            hint: "In-app alerts recorded but not delivered",
          },
          {
            label: "Extraction pending",
            value: extraction.pending,
          },
        ]}
      />

      {scan && (
        <InlineAlert
          tone={scan.alerts_created > 0 ? "success" : "info"}
          title="Maturity scan result"
        >
          Scanned {scan.scanned} monitored record(s): {scan.alerts_created} new alert(s),{" "}
          {scan.alerts_existing} already present, {scan.transitions} lifecycle transition(s),{" "}
          {scan.expired} marked expired
          {scan.skipped_no_recipient > 0
            ? `, ${scan.skipped_no_recipient} skipped with no active recipient`
            : ""}
          . Alert policy {scan.policy_version}. Repeated runs cannot duplicate an alert.
        </InlineAlert>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel
          title="Accounts by role"
          description="Least privilege: administrative access is audited."
          bodyClassName="p-0"
          actions={
            <Link
              to="/app/admin/users"
              className="text-xs font-medium text-primary hover:underline"
            >
              Manage
            </Link>
          }
        >
          <TableShell caption="Accounts by role">
            <thead>
              <tr>
                <th className={thClass}>Role</th>
                <th className={thClass}>Accounts</th>
              </tr>
            </thead>
            <tbody>
              {accounts.by_role.map((entry) => (
                <tr key={entry.role} className="hover:bg-canvas/60">
                  <td className={tdClass}>
                    <span className="text-[13px] text-ink">{ROLE_LABELS[entry.role]}</span>
                  </td>
                  <td className={tdClass}>
                    <span className="tnum text-[13px]">{entry.count}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>

        <div className="space-y-5">
          <Panel
            title="Scheduled maturity monitoring"
            description="Single-instance scheduler, safe to re-run after downtime."
          >
            <ProvenanceStrip
              items={[
                {
                  label: "Scheduler",
                  value: scheduler.enabled ? "Enabled" : "Disabled",
                  tone: scheduler.enabled ? "success" : "warning",
                  note: `Daily at ${String(scheduler.hour_utc).padStart(2, "0")}:00 UTC.`,
                },
                {
                  label: "Thresholds",
                  value: scheduler.thresholds.map((value) => `${value}d`).join(" / "),
                  note: `Evaluated in ${scheduler.timezone}.`,
                },
                {
                  label: "Last run",
                  value: scheduler.last_run_at ? formatDateTime(scheduler.last_run_at) : "Never",
                  tone: scheduler.last_run_at ? "neutral" : "warning",
                },
                {
                  label: "Alerts created last run",
                  value: lastRunValues.alerts_created === undefined
                    ? "—"
                    : String(lastRunValues.alerts_created),
                },
              ]}
            />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button size="sm" loading={scanning} onClick={() => void runScan()}>
                Run now
              </Button>
              <span className="text-[11px] text-muted">
                A run is idempotent: one alert per threshold per record per recipient.
              </span>
            </div>
          </Panel>

          <Panel title="Delivery and extraction" description="Honest operational state.">
            <ul className="space-y-3 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">In-app alerts delivered</span>
                <span className="tnum font-medium">{delivery.in_app}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">Failed deliveries</span>
                <span className="tnum font-medium">{delivery.failed}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">Email delivery</span>
                <Badge tone="warning">Not configured</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">Image OCR</span>
                <Badge tone="warning">Unavailable — PDF text only</Badge>
              </li>
            </ul>
            <p className="mt-3 border-t border-line pt-3 text-[11px] leading-5 text-muted">
              Alerts are stored in-app and survive a delivery failure; only the email channel is
              missing.
            </p>
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel
          title="Integrations"
          description="Simulated and unconfigured services are labelled, never implied."
        >
          <ul className="divide-y divide-line">
            {workspace.integrations.map((integration) => (
              <li key={integration.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <Database size={15} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">
                    {humanAction(integration.key)}
                    <span className="sr-only">: {integration.state}</span>
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">{integration.label}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge
                    tone={
                      integration.state === "ACTIVE"
                        ? "success"
                        : integration.state === "SIMULATED"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {integration.state.replace("_", " ")}
                  </Badge>
                  {!integration.production_ready && (
                    <span className="text-[10px] uppercase tracking-[0.05em] text-muted">
                      Not production ready
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-line pt-3 text-[11px] leading-5 text-muted">
            Bank verification has no live integration: there is no authorised bank API,
            credential or dataset in this prototype.
          </p>
        </Panel>

        <div className="space-y-5">
          <Panel
            title="Release queue"
            description="Oldest first, with evidence state."
            bodyClassName="p-0"
          >
            <ReleaseQueueTable
              items={workspace.release_queue}
              caption="Release requests awaiting a checker"
              emptyTitle="No request awaiting a decision"
              emptyDescription="Nothing is currently waiting on an approving officer."
            />
          </Panel>

          <Panel
            title="Integrity check"
            description="Hash chain over recorded audit history."
            actions={
              <Button
                size="sm"
                loading={checking}
                onClick={() => void runChainCheck()}
                icon={<ShieldAlert size={14} aria-hidden />}
              >
                Verify chain
              </Button>
            }
          >
            <ul className="space-y-3 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">Last verified</span>
                <span className="tnum">
                  {formatDateTime(
                    chain?.checked_at ?? workspace.chain_check.last_checked_at,
                  )}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">State</span>
                <Badge
                  tone={
                    chain === null
                      ? "neutral"
                      : chain.valid
                        ? "success"
                        : "danger"
                  }
                >
                  {chain === null ? "Not checked in this session" : chain.valid ? "Intact" : "Broken"}
                </Badge>
              </li>
              {chain && (
                <li className="flex items-center justify-between gap-3">
                  <span className="text-muted">Events checked</span>
                  <span className="tnum font-medium">{chain.checked}</span>
                </li>
              )}
            </ul>
            {chain && (
              <p className="mt-3 border-t border-line pt-3 text-[11px] leading-5 text-muted">
                {chain.limitation}
              </p>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Recent administrative and system events"
        description="Audited actions, including runs of the integrity check."
        bodyClassName="p-0"
      >
        {workspace.recent_admin_events.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted sm:px-5">
            No administrative events recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {workspace.recent_admin_events.map((event) => (
              <li
                key={event.id}
                className="flex items-start gap-3 px-4 py-3 first:pt-3 sm:px-5"
              >
                <Activity size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-ink">{humanAction(event.action)}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {event.actor_label} · {formatDateTime(event.occurred_at)}
                    {event.entity_label ? ` · ${event.entity_label}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-muted">
                  #{event.sequence}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <WorkspaceNote>{workspace.next_step}</WorkspaceNote>
      <WorkspaceNote>
        Administrative access is audited. Secrets are never displayed here, and no administrative
        action silently alters a financial decision.
      </WorkspaceNote>
    </div>
  );
}
