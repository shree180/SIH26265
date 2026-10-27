import { AlertTriangle, ClipboardCheck, History } from "lucide-react";
import { Link } from "react-router-dom";
import { InlineAlert, LinkButton, Panel } from "../../components/ui";
import type { DashboardSummary, ReviewerWorkspace } from "../../lib/types";
import { MetricGrid, RecordsTable, WorkspaceHero, WorkspaceNote } from "./shared";

/** Which submissions need a decision, and what is blocking them. */
export default function ReviewerDashboard({
  summary,
  workspace,
}: {
  summary: DashboardSummary;
  workspace: ReviewerWorkspace;
}) {
  const { counts } = workspace;

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
            <LinkButton to="/app/review-queue" icon={<ClipboardCheck size={15} aria-hidden />}>
              Open review queue
            </LinkButton>
            <LinkButton
              to="/app/audit"
              variant="secondary"
              icon={<History size={15} aria-hidden />}
            >
              Audit trail
            </LinkButton>
          </>
        }
      />

      <MetricGrid
        items={[
          {
            label: "Awaiting a decision",
            value: counts.awaiting_decision,
            to: "/app/review-queue",
            hint: "Submitted or under review across all institutions",
          },
          {
            label: "Resubmitted",
            value: counts.resubmitted_after_correction,
            to: "/app/review-queue",
            hint: "Returned for correction and sent back to you",
          },
          {
            label: "Unresolved discrepancies",
            value: counts.unresolved_discrepancies,
            to: "/app/fdrs?discrepancy=with",
            tone: counts.unresolved_discrepancies > 0 ? "warning" : "neutral",
          },
          {
            label: "Submitted without evidence",
            value: counts.missing_evidence,
            to: "/app/review-queue",
            tone: counts.missing_evidence > 0 ? "warning" : "neutral",
          },
          {
            label: `Overdue beyond ${workspace.review_sla_hours} h`,
            value: counts.overdue_beyond_sla,
            tone: counts.overdue_beyond_sla > 0 ? "danger" : "neutral",
            hint: counts.overdue_beyond_sla > 0 ? "Oldest open reviews first" : undefined,
          },
          {
            label: "Urgent maturity",
            value: counts.urgent_maturity,
            to: "/app/maturity",
            tone: counts.urgent_maturity > 0 ? "warning" : "neutral",
          },
          {
            label: "Open discrepancies (records)",
            value: summary.metrics.discrepancies,
            to: "/app/fdrs?discrepancy=with",
          },
          {
            label: "Release queue",
            value: summary.metrics.pending_release_approvals,
            to: "/app/release-requests?status=PENDING_CHECKER",
            hint: "Decided by an approving officer, not by you",
          },
        ]}
      />

      <Panel
        title="Review inbox"
        description="Highest priority first, with the reason each record needs attention."
        bodyClassName="p-0"
        actions={
          <Link
            to="/app/review-queue"
            className="text-xs font-medium text-primary hover:underline"
          >
            Full queue
          </Link>
        }
      >
        <RecordsTable
          records={workspace.review_inbox}
          caption="Submissions awaiting a review decision"
          showInstitution
          reasons={workspace.inbox_reasons}
          emptyTitle="Nothing is waiting for review"
          emptyDescription="No submission is currently inside your review scope. New submissions appear here immediately."
        />
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel
          title="Discrepancy worklist"
          description="Entered values that disagree with the extracted evidence."
          bodyClassName="p-0"
        >
          <RecordsTable
            records={workspace.discrepancy_worklist}
            caption="Records with unresolved discrepancies"
            showInstitution
            emptyTitle="No open discrepancies"
            emptyDescription="Every extracted value currently agrees with the submitted value, or has been reviewed."
          />
        </Panel>

        <div className="space-y-5">
          <Panel
            title="Returned for correction"
            description="Waiting on the institution to fix a value and resubmit."
            bodyClassName="p-0"
          >
            <RecordsTable
              records={workspace.correction_resubmissions}
              caption="Records returned for correction and resubmitted"
              showInstitution
              emptyTitle="No corrections in flight"
              emptyDescription="Nothing has been returned to an institution and resubmitted."
            />
          </Panel>

          <Panel
            title="Maturity risk"
            description="Inside the nearest threshold, or already past maturity."
            bodyClassName="p-0"
          >
            <RecordsTable
              records={workspace.maturity_risk}
              caption="Records close to maturity"
              showInstitution
              emptyTitle="No urgent maturities"
              emptyDescription="No open record is inside the nearest maturity threshold."
            />
          </Panel>
        </div>
      </div>

      <InlineAlert tone="warning" title="Automated checks are not verification">
        <span className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Extraction and the priority score only tell you where to look. Recording a
            verification is your judgement based on the evidence, and a simulated provider result
            is never treated as bank confirmation.
          </span>
        </span>
      </InlineAlert>

      <WorkspaceNote>{workspace.next_step}</WorkspaceNote>
    </div>
  );
}
