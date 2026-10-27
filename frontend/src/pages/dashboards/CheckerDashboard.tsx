import { Scale, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { InlineAlert, LinkButton, Panel } from "../../components/ui";
import type { CheckerWorkspace, DashboardSummary } from "../../lib/types";
import {
  MetricGrid,
  ReleaseQueueTable,
  WorkspaceHero,
  WorkspaceNote,
} from "./shared";

/** Which release decisions can this checker safely make. */
export default function CheckerDashboard({
  summary,
  workspace,
}: {
  summary: DashboardSummary;
  workspace: CheckerWorkspace;
}) {
  const { counts, eligibility } = workspace;

  return (
    <div className="rise space-y-6">
      <WorkspaceHero
        role={workspace.role}
        title={workspace.title}
        question={workspace.question}
        scopeLabel={summary.scope.label ?? "All institutions"}
        businessDate={summary.business_date}
        actions={
          <LinkButton
            to="/app/release-requests?status=PENDING_CHECKER"
            icon={<ShieldCheck size={15} aria-hidden />}
          >
            Decide release requests
          </LinkButton>
        }
      />

      <MetricGrid
        items={[
          {
            label: "Awaiting your decision",
            value: counts.awaiting_your_decision,
            to: "/app/release-requests?status=PENDING_CHECKER",
            hint: "Excludes anything you raised yourself",
          },
          {
            label: "Raised by you",
            value: counts.raised_by_you_blocked,
            hint: "Must stay at zero — you cannot decide your own request",
            tone: counts.raised_by_you_blocked > 0 ? "warning" : "neutral",
          },
          {
            label: "Decided by you",
            value: counts.decided_by_you,
            to: "/app/release-requests",
            hint: "Approve, return or reject decisions you recorded",
          },
          {
            label: `Waiting beyond ${workspace.approval_sla_hours} h`,
            value: counts.beyond_sla,
            tone: counts.beyond_sla > 0 ? "warning" : "neutral",
            hint: counts.beyond_sla > 0 ? "Oldest requests first" : undefined,
          },
        ]}
      />

      <Panel
        title="Awaiting your decision"
        description="Eligible release requests where you are not the maker."
        bodyClassName="p-0"
        actions={
          <Link
            to="/app/release-requests?status=PENDING_CHECKER"
            className="text-xs font-medium text-primary hover:underline"
          >
            Open queue
          </Link>
        }
      >
        <ReleaseQueueTable
          items={workspace.awaiting_decision}
          caption="Release requests awaiting a checker decision"
          emptyTitle="Nothing is waiting on you"
          emptyDescription="No release request in your scope is awaiting a decision you are allowed to make."
        />
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel
          title="Separation of duties"
          description="Enforced on the server, not by hiding a button."
        >
          <ul className="space-y-3">
            {[
              {
                label: "Self-approval blocked",
                value: eligibility.self_approval_blocked,
                detail:
                  "A request raised by you is refused by the API even if a decision is submitted directly.",
              },
              {
                label: "Manual verification required",
                value: eligibility.requires_manual_verification,
                detail:
                  "A simulated provider result cannot make a record releasable; a person must record the verification.",
              },
              {
                label: "Evidence required",
                value: eligibility.requires_evidence,
                detail: "Open the record and inspect the receipt before deciding.",
              },
            ].map((rule) => (
              <li key={rule.label} className="flex gap-3">
                <span
                  aria-hidden
                  className={
                    rule.value
                      ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-success"
                      : "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning"
                  }
                />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">
                    {rule.label}
                    <span className="sr-only">{rule.value ? ": enforced" : ": not enforced"}</span>
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">{rule.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <InlineAlert tone="info" title="A decision here is not a fund transfer">
              {eligibility.note}
            </InlineAlert>
          </div>
        </Panel>

        <Panel
          title="Decisions you recorded"
          description="Most recent decisions where you were the checker."
          bodyClassName="p-0"
        >
          <ReleaseQueueTable
            items={workspace.decided_by_you}
            caption="Release decisions recorded by this checker"
            emptyTitle="No decisions recorded yet"
            emptyDescription="Once you approve, return or reject a request it appears here with its reason."
            showDecision
          />
        </Panel>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Scale size={13} className="text-muted" aria-hidden />
        <WorkspaceNote>{workspace.next_step}</WorkspaceNote>
      </div>
    </div>
  );
}
