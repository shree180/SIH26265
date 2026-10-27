import { useEffect, useState } from "react";
import { ApiError, api } from "../lib/api";
import type { ReleaseRequest } from "../lib/types";
import {
  Button,
  InlineAlert,
  Modal,
  TextareaField,
  cn,
} from "./ui";

export function ReleaseDecisionDialog({
  request,
  currentUserId,
  onClose,
  onDecided,
}: {
  request: ReleaseRequest;
  currentUserId: string;
  onClose: () => void;
  onDecided: (message: string) => void | Promise<void>;
}) {
  const [decision, setDecision] = useState<"APPROVE" | "REJECT" | "RETURN">("APPROVE");
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selfApproval = request.requested_by?.id === currentUserId;

  useEffect(() => {
    setDecision("APPROVE");
    setReason("");
    setError(null);
  }, [request.id]);

  const submit = async () => {
    setWorking(true);
    setError(null);
    try {
      await api.post<ReleaseRequest>(`/release-requests/${request.id}/decision`, {
        decision,
        reason: reason.trim(),
        expected_version: request.version,
      });
      await onDecided("Release decision recorded in the audit trail.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The decision could not be recorded.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Decide release request"
      description="Maker-checker decision. This records an authorization only; no funds move and no bank is contacted."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button
            variant={decision === "APPROVE" ? "primary" : decision === "REJECT" ? "danger" : "secondary"}
            loading={working}
            disabled={selfApproval || reason.trim().length < 5}
            onClick={() => void submit()}
            title={selfApproval ? "You cannot decide a request you raised." : undefined}
          >
            Record decision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md border border-line bg-canvas/50 px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">Request</p>
          <p className="mt-1 text-sm">
            {request.fdr_reference} · raised by {request.requested_by?.name ?? "—"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted">{request.request_reason}</p>
        </div>

        {selfApproval && (
          <InlineAlert tone="danger" title="Self-approval blocked">
            Maker-checker separation prevents the person who raised the request from deciding it. The
            server enforces this regardless of the interface.
          </InlineAlert>
        )}

        <fieldset>
          <legend className="text-[13px] font-medium">Decision</legend>
          <div className="mt-2 space-y-2">
            {[
              {
                value: "APPROVE" as const,
                title: "Approve",
                text: "Marks the record released in this system.",
              },
              {
                value: "RETURN" as const,
                title: "Return for correction",
                text: "Sends the request back to the maker.",
              },
              {
                value: "REJECT" as const,
                title: "Reject",
                text: "Closes the request; the record returns to its prior state.",
              },
            ].map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-md border px-3 py-2.5",
                  decision === option.value ? "border-primary bg-primary-soft/40" : "border-line",
                )}
              >
                <input
                  type="radio"
                  name="release-decision"
                  value={option.value}
                  checked={decision === option.value}
                  onChange={() => setDecision(option.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-[13px] font-medium">{option.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted">{option.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <TextareaField
          id="decision-reason"
          label="Decision reason"
          rows={3}
          required
          value={reason}
          maxLength={2000}
          onChange={(event) => setReason(event.target.value)}
          hint="At least 5 characters. Stored with the decision and audited."
        />

        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Modal>
  );
}
