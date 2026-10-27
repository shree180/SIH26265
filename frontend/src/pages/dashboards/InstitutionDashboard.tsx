import { FileText, Plus, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { InlineAlert, LinkButton, Panel, ProvenanceStrip, StatCard } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import type { DashboardSummary, InstitutionWorkspace } from "../../lib/types";
import {
  ActionList,
  MetricGrid,
  RecordsTable,
  ReleaseQueueTable,
  WorkspaceHero,
  WorkspaceNote,
} from "./shared";

/** What is happening to this institution's FDRs, and what needs action. */
export default function InstitutionDashboard({
  summary,
  workspace,
}: {
  summary: DashboardSummary;
  workspace: InstitutionWorkspace;
}) {
  const { metrics } = summary;
  const health = workspace.extraction_health;

  return (
    <div className="rise space-y-6">
      <WorkspaceHero
        role={workspace.role}
        title={workspace.title}
        question={workspace.question}
        scopeLabel={summary.scope.label ?? "Your institution"}
        businessDate={summary.business_date}
        actions={
          <>
            <LinkButton to="/app/fdrs/new" icon={<Plus size={15} aria-hidden />}>
              Submit FDR
            </LinkButton>
            <LinkButton
              to="/app/fdrs"
              variant="secondary"
              icon={<FileText size={15} aria-hidden />}
            >
              All records
            </LinkButton>
          </>
        }
      />

      <MetricGrid
        items={[
          {
            label: "Records",
            value: metrics.total_fdrs,
            to: "/app/fdrs",
            hint: "Everything your institution submitted",
          },
          { label: "Active", value: metrics.active, to: "/app/fdrs?status=ACTIVE,MATURING" },
          {
            label: "Awaiting review",
            value: metrics.pending_review,
            to: "/app/fdrs?status=SUBMITTED,UNDER_REVIEW",
          },
          {
            label: "Corrections to clear",
            value: metrics.correction_required,
            to: "/app/fdrs?status=CORRECTION_REQUIRED",
            tone: metrics.correction_required > 0 ? "warning" : "neutral",
          },
          {
            label: "Maturity ≤ 30 days",
            value: metrics.upcoming_maturity,
            to: "/app/maturity?window=30",
          },
          {
            label: "Overdue",
            value: metrics.overdue,
            to: "/app/maturity?window=overdue",
            tone: metrics.overdue > 0 ? "danger" : "neutral",
            hint: metrics.overdue > 0 ? "Agree the next step with your reviewer" : undefined,
          },
          {
            label: "Open discrepancies",
            value: metrics.discrepancies,
            to: "/app/fdrs?discrepancy=with",
          },
          {
            label: "Release requests",
            value: metrics.own_pending_release_requests,
            to: "/app/release-requests",
            hint:
              metrics.own_pending_release_requests > 0
                ? "A different officer must decide these"
                : undefined,
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Needs your action"
          description="Counted from your institution's stored records, not estimated."
        >
          <ActionList items={workspace.action_items} />
        </Panel>

        <div className="space-y-5">
          <Panel
            title="Evidence and extraction"
            description="What could be read from the receipts you uploaded."
          >
            <ProvenanceStrip
              items={[
                {
                  label: "Receipts stored",
                  value: String(health.documents),
                  note: "Held privately; downloadable only by authorised users.",
                },
                {
                  label: "Text extracted",
                  value: String(health.extracted),
                  tone: health.extracted > 0 ? "success" : "neutral",
                  note: "A candidate value, never a confirmation of authenticity.",
                },
                {
                  label: "Values to confirm",
                  value: String(health.unreviewed_fields),
                  tone: health.unreviewed_fields > 0 ? "warning" : "neutral",
                  note: "Confirm or correct each extracted value before relying on it.",
                },
                {
                  label: "Manual entry needed",
                  value: String(health.unavailable),
                  tone: health.unavailable > 0 ? "warning" : "neutral",
                  note: "No usable text layer; image OCR is not enabled.",
                },
              ]}
            />
            <div className="mt-4">
              <InlineAlert tone="info" title="Extraction is not proof of authenticity">
                Reading a field from a PDF only shows the document agrees or disagrees with what
                you typed. Confirming authenticity needs a manual check by a reviewer.
              </InlineAlert>
            </div>
          </Panel>

          <Panel
            title="Release requests"
            description="Raised by your institution on eligible records."
            actions={
              <Link
                to="/app/release-requests"
                className="text-xs font-medium text-primary hover:underline"
              >
                All requests
              </Link>
            }
          >
            <ReleaseQueueTable
              items={workspace.release_requests}
              caption="Release requests for this institution"
              emptyTitle="No release requests"
              emptyDescription="A release can be requested once a record is manually verified and active."
            />
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel
          title="Upcoming maturities"
          description="Open records inside the configured maturity window."
          bodyClassName="p-0"
          actions={
            <Link
              to="/app/maturity?window=30"
              className="text-xs font-medium text-primary hover:underline"
            >
              Maturity queue
            </Link>
          }
        >
          <RecordsTable
            records={workspace.upcoming_maturities}
            caption="Upcoming maturities for this institution"
            emptyTitle="No maturity inside the window"
            emptyDescription="No open record of this institution matures within the configured thresholds."
          />
        </Panel>

        <Panel
          title="Recently created"
          description="Your most recent submissions."
          bodyClassName="p-0"
        >
          <RecordsTable
            records={workspace.recent_submissions}
            caption="Recently created records"
            emptyTitle="Nothing submitted yet"
            emptyDescription="Submit your first FDR and attach its receipt to start a review."
          />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Extraction pending"
          value={health.pending}
          hint="Uploaded receipts still waiting to be read"
        />
        <StatCard
          label="Needs review"
          value={health.needs_review}
          hint="Documents whose text was read but not yet confirmed"
        />
        <StatCard
          label="Drafts"
          value={
            workspace.action_items.find((item) => item.key === "DRAFT")?.count ?? 0
          }
          hint="Drafts are invisible to reviewers"
          to="/app/fdrs?status=DRAFT"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Upload size={13} className="text-muted" aria-hidden />
        <WorkspaceNote>{workspace.next_step}</WorkspaceNote>
      </div>
      <WorkspaceNote>
        Metrics are scoped to your institution and computed from stored records at{" "}
        {formatDateTime(workspace.generated_at)}. This prototype does not contact a bank and does
        not move funds.
      </WorkspaceNote>
    </div>
  );
}
