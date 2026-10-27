import { FileSearch, Fingerprint, History, ShieldCheck } from "lucide-react";
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
import { formatDateTime, shortHash } from "../../lib/format";
import type { AuditChainResult, AuditorWorkspace, DashboardSummary } from "../../lib/types";
import { MetricGrid, WorkspaceHero, WorkspaceNote } from "./shared";

/** Can this auditor trace what happened, when, by whom, and on what evidence. */
export default function AuditorDashboard({
  summary,
  workspace,
}: {
  summary: DashboardSummary;
  workspace: AuditorWorkspace;
}) {
  const toast = useToast();
  const [chain, setChain] = useState<AuditChainResult | null>(null);
  const [checking, setChecking] = useState(false);

  const runChainCheck = async () => {
    setChecking(true);
    try {
      const result = await api.post<AuditChainResult>("/admin/audit/verify-chain");
      setChain(result);
      if (result.valid) {
        toast.success(`Chain verified across ${result.checked} event(s).`);
      } else {
        toast.error(
          `Chain problem detected at sequence ${result.broken_sequence ?? "unknown"}.`,
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The integrity check could not be completed.",
      );
    } finally {
      setChecking(false);
    }
  };

  // Fresh in-session result when available, otherwise the last recorded check.
  const lastCheckedAt = chain?.checked_at ?? workspace.chain_check.last_checked_at;
  const chainValid = chain ? chain.valid : workspace.chain_check.valid;
  const chainChecked = chain ? chain.checked : workspace.chain_check.checked;
  const brokenSequence = chain ? chain.broken_sequence : workspace.chain_check.broken_sequence;

  return (
    <div className="rise space-y-6">
      <WorkspaceHero
        role={workspace.role}
        title={workspace.title}
        question={workspace.question}
        scopeLabel={summary.scope.label ?? "All institutions"}
        businessDate={summary.business_date}
        actions={
          <>
            <Button
              variant="primary"
              loading={checking}
              onClick={() => void runChainCheck()}
              icon={<ShieldCheck size={15} aria-hidden />}
            >
              Verify audit chain
            </Button>
            <LinkButton to="/app/audit" variant="secondary" icon={<History size={15} aria-hidden />}>
              Audit trail
            </LinkButton>
          </>
        }
      />

      <MetricGrid
        items={[
          {
            label: "Records in scope",
            value: workspace.coverage.records_in_scope,
            to: "/app/fdrs",
            hint: "Read-only access across every institution",
          },
          {
            label: "Institutions covered",
            value: workspace.coverage.institutions_in_scope,
            to: "/app/fdrs",
          },
          {
            label: "Closed records",
            value: workspace.coverage.closed_records,
            to: "/app/fdrs",
            hint: "Rejected, replaced, released or expired",
          },
          {
            label: "Unresolved discrepancies",
            value: workspace.coverage.unresolved_discrepancies,
            to: "/app/fdrs?discrepancy=with",
            tone: workspace.coverage.unresolved_discrepancies > 0 ? "warning" : "neutral",
          },
        ]}
      />

      <InlineAlert tone="info" title="Read-only workspace">
        Audit access is read-only. Records, decisions and audit events cannot be edited, deleted or
        re-run from here; the integrity check appends a verification event.
      </InlineAlert>

      <Panel
        title="Integrity check"
        description="Hash chain over the recorded audit history."
        actions={
          <Button
            size="sm"
            loading={checking}
            onClick={() => void runChainCheck()}
            icon={<Fingerprint size={14} aria-hidden />}
          >
            Run check
          </Button>
        }
      >
        <ProvenanceStrip
          items={[
            {
              label: "Last check",
              value: lastCheckedAt ? formatDateTime(lastCheckedAt) : "Not yet run",
              tone: lastCheckedAt ? "neutral" : "warning",
              note: chain?.checked_at
                ? "Ran in this session."
                : "Run the check to record a verification event.",
            },
            {
              label: "Chain state",
              value:
                chainValid === true ? "Intact" : chainValid === false ? "Broken" : "Unverified",
              tone:
                chainValid === true ? "success" : chainValid === false ? "danger" : "warning",
            },
            {
              label: "Events checked",
              value: chainChecked === null ? "—" : String(chainChecked),
            },
            {
              label: "First break",
              value:
                brokenSequence === null ? "None" : `Sequence ${brokenSequence}`,
              tone: brokenSequence === null ? "neutral" : "danger",
            },
          ]}
        />
        {chain && (
          <p className="mt-3 text-xs text-muted">
            Chain head {shortHash(chain.chain_head ?? "")} · checked{" "}
            {formatDateTime(chain.checked_at)}
          </p>
        )}
        <div className="mt-4">
          <InlineAlert tone="warning" title="What this does and does not prove">
            {chain?.limitation ?? workspace.limitation}
          </InlineAlert>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Recent lifecycle transitions"
          description="Every recorded state change, including automated ones."
          bodyClassName="p-0"
        >
          {workspace.recent_transitions.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted sm:px-5">
              No lifecycle transitions are recorded in your scope yet.
            </p>
          ) : (
            <TableShell caption="Recent lifecycle transitions">
              <thead>
                <tr>
                  <th className={thClass}>Record</th>
                  <th className={thClass}>Transition</th>
                  <th className={thClass}>Actor</th>
                  <th className={thClass}>Reason</th>
                  <th className={thClass}>When</th>
                </tr>
              </thead>
              <tbody>
                {workspace.recent_transitions.map((transition) => (
                  <tr key={transition.id} className="hover:bg-canvas/60">
                    <td className={tdClass}>
                      <Link
                        to={`/app/fdrs/${transition.fdr_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {transition.reference_number}
                      </Link>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {transition.institution_name ?? "—"}
                      </p>
                    </td>
                    <td className={tdClass}>
                      <p className="text-xs text-ink">{transition.action_label}</p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {transition.from_label ?? "—"} → {transition.to_label ?? "—"}
                      </p>
                    </td>
                    <td className={tdClass}>
                      <span className="text-xs text-ink">{transition.actor_label}</span>
                    </td>
                    <td className={tdClass}>
                      <span className="text-[11px] leading-4 text-muted">
                        {transition.reason ?? "No reason recorded"}
                      </span>
                    </td>
                    <td className={tdClass}>
                      <span className="whitespace-nowrap text-[11px] text-muted">
                        {formatDateTime(transition.created_at)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel
            title="Verification provenance"
            description="Where the verification signal came from."
          >
            <ul className="space-y-3 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">Manual checks recorded</span>
                <span className="tnum font-medium">{workspace.checks.manual_checks}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">Simulated provider attempts</span>
                <span className="tnum font-medium">{workspace.checks.simulated_checks}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">Manually confirmed records</span>
                <span className="tnum font-medium">
                  {workspace.checks.manually_confirmed_records}
                </span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted">Provider-only records</span>
                <span className="tnum font-medium">{workspace.checks.provider_only_records}</span>
              </li>
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Badge tone="warning">SIMULATED results are never confirmation</Badge>
            </div>
          </Panel>

          <Panel title="Sources you can use" description="Nothing here is generated for show.">
            <ul className="space-y-2.5 text-xs leading-5 text-muted">
              <li className="flex gap-2">
                <FileSearch size={14} className="mt-0.5 shrink-0" aria-hidden />
                Every record's audit and workflow tabs reconstruct who changed what and when.
              </li>
              <li className="flex gap-2">
                <History size={14} className="mt-0.5 shrink-0" aria-hidden />
                The audit trail page filters by actor, action, entity and date.
              </li>
              <li className="flex gap-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
                Exports you generate are themselves audited.
              </li>
            </ul>
          </Panel>
        </div>
      </div>

      <WorkspaceNote>{workspace.next_step}</WorkspaceNote>
    </div>
  );
}
