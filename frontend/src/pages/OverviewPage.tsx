import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingRows, Panel } from "../components/ui";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { DashboardSummary } from "../lib/types";
import AuditorDashboard from "./dashboards/AuditorDashboard";
import CheckerDashboard from "./dashboards/CheckerDashboard";
import InstitutionDashboard from "./dashboards/InstitutionDashboard";
import ReviewerDashboard from "./dashboards/ReviewerDashboard";
import SystemAdminDashboard from "./dashboards/SystemAdminDashboard";

/**
 * The landing screen dispatches on the role the server reported for this
 * session. Every workspace below is rendered from `/dashboard/summary`, and the
 * server scopes the data — hiding a control here is never the security control.
 */
export default function OverviewPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<DashboardSummary>("/dashboard/summary"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) {
    return (
      <div className="space-y-4">
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="panel h-[92px] animate-pulse bg-line/40" />
          ))}
        </div>
        <Panel title="Loading your workspace">
          <LoadingRows rows={5} label={loading ? "Loading workspace" : "Workspace unavailable"} />
        </Panel>
      </div>
    );
  }

  const workspace = data.workspace;

  // A newer UI against an older API (or a rolling deploy) must degrade, not crash.
  if (!workspace) {
    return (
      <div className="space-y-4">
        <ErrorState
          message="This session's workspace could not be loaded from the API. The server may be running an older version — reload, or contact an administrator if it persists."
          onRetry={() => void load()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {data.truncated && (
        <p className="rounded-md border border-warning/30 bg-warning/5 px-3.5 py-2 text-xs text-muted">
          These aggregates cover the first 5,000 scoped records. Refine filters for a precise view.
        </p>
      )}

      {workspace.kind === "INSTITUTION" && (
        <InstitutionDashboard summary={data} workspace={workspace} />
      )}
      {workspace.kind === "REVIEWER" && (
        <ReviewerDashboard summary={data} workspace={workspace} />
      )}
      {workspace.kind === "CHECKER" && <CheckerDashboard summary={data} workspace={workspace} />}
      {workspace.kind === "AUDITOR" && <AuditorDashboard summary={data} workspace={workspace} />}
      {workspace.kind === "SYSTEM_ADMIN" && (
        <SystemAdminDashboard summary={data} workspace={workspace} />
      )}

      <p className="border-t border-line pt-4 text-[11px] leading-5 text-muted">
        Metrics are computed from stored records scoped to your role (
        {data.scope.label ?? "all institutions"}) and were generated at {formatDateTime(data.generated_at)}.
        Priority is a prioritisation aid and never approves, rejects or releases a record.
      </p>
    </div>
  );
}
