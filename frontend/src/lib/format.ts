import type {
  DiscrepancyStatus,
  LifecycleStatus,
  Priority,
  Role,
  VerificationStatus,
} from "./types";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export const ROLE_LABELS: Record<Role, string> = {
  INSTITUTION_ADMIN: "Institution Administrator",
  REVIEWING_OFFICER: "Reviewing Officer",
  APPROVING_OFFICER: "Approving Officer",
  AUDITOR: "Auditor",
  SYSTEM_ADMIN: "System Administrator",
};

export const STATUS_LABELS: Record<LifecycleStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  CORRECTION_REQUIRED: "Correction required",
  REJECTED: "Rejected",
  VERIFIED: "Verified",
  ACTIVE: "Active",
  MATURING: "Maturing",
  RENEWAL_PENDING: "Renewal pending",
  REPLACED: "Replaced",
  RELEASE_REQUESTED: "Release requested",
  PENDING_CHECKER: "Pending checker",
  RELEASED: "Released",
  EXPIRED: "Expired",
};

export const STATUS_TONES: Record<LifecycleStatus, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  UNDER_REVIEW: "info",
  CORRECTION_REQUIRED: "warning",
  REJECTED: "danger",
  VERIFIED: "accent",
  ACTIVE: "success",
  MATURING: "warning",
  RENEWAL_PENDING: "warning",
  REPLACED: "neutral",
  RELEASE_REQUESTED: "warning",
  PENDING_CHECKER: "warning",
  RELEASED: "success",
  EXPIRED: "danger",
};

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  UNVERIFIED: "Unverified",
  MANUAL_CONFIRMED: "Manually confirmed",
  SIMULATION_ONLY: "Simulation only",
  MISMATCH_REPORTED: "Mismatch reported",
  FAILED_VERIFICATION: "Verification failed",
};

export const VERIFICATION_TONES: Record<VerificationStatus, Tone> = {
  UNVERIFIED: "neutral",
  MANUAL_CONFIRMED: "success",
  SIMULATION_ONLY: "warning",
  MISMATCH_REPORTED: "danger",
  FAILED_VERIFICATION: "danger",
};

export const DISCREPANCY_LABELS: Record<DiscrepancyStatus, string> = {
  MATCH: "Matches",
  MISMATCH: "Mismatch",
  MISSING_IN_DOCUMENT: "Not in document",
  REVIEWED_MATCH: "Reviewed — matches",
  REVIEWED_OVERRIDE: "Reviewed — differs",
  DISMISSED: "Dismissed",
  LOW_CONFIDENCE: "Low confidence",
};

export const DISCREPANCY_TONES: Record<DiscrepancyStatus, Tone> = {
  MATCH: "success",
  MISMATCH: "danger",
  MISSING_IN_DOCUMENT: "warning",
  REVIEWED_MATCH: "success",
  REVIEWED_OVERRIDE: "warning",
  DISMISSED: "neutral",
  LOW_CONFIDENCE: "warning",
};

export const VERIFICATION_OPTIONS = [
  "UNVERIFIED",
  "MANUAL_CONFIRMED",
  "SIMULATION_ONLY",
  "MISMATCH_REPORTED",
  "FAILED_VERIFICATION",
] as const;

export function formatAmount(amount: string | number, currency = "INR"): string {
  const numeric = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(numeric)) return String(amount);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const dateOnly = value.length <= 10;
  const parsed = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(dateOnly ? { timeZone: "UTC" } : {}),
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysLabel(days: number): string {
  if (days === 0) return "matures today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
}

export function daysTone(days: number): Tone {
  if (days < 0) return "danger";
  if (days <= 7) return "warning";
  if (days <= 30) return "info";
  return "neutral";
}

export function priorityTone(priority: Priority): Tone {
  if (priority.score >= 60) return "danger";
  if (priority.score >= 35) return "warning";
  if (priority.score > 0) return "info";
  return "neutral";
}

export function priorityLabel(score: number): string {
  if (score >= 60) return "High";
  if (score >= 35) return "Medium";
  if (score > 0) return "Low";
  return "None";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function shortHash(hash: string, length = 12): string {
  return hash.length > length ? `${hash.slice(0, length)}…` : hash;
}

export function sentenceCase(value: string): string {
  const text = value.replace(/[_-]+/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function humanAction(action: string): string {
  const labels: Record<string, string> = {
    FDR_CREATED: "Record created",
    FDR_UPDATED: "Record updated",
    FDR_TRANSITION: "Lifecycle transition",
    DOCUMENT_UPLOADED: "Document uploaded",
    DOCUMENT_EXTRACTED: "Document text extracted",
    EXTRACTION_REVIEWED: "Extraction reviewed",
    VERIFICATION_RECORDED: "Verification recorded",
    RELEASE_REQUESTED: "Release requested",
    RELEASE_DECISION: "Release decision",
    RENEWAL_CREATED: "Renewal created",
    EXPORT_FDRS: "CSV export",
    USER_SIGNED_IN: "Signed in",
    USER_SIGNED_OUT: "Signed out",
    USER_UPDATED: "User updated",
    INSTITUTION_CREATED: "Institution added",
    INSTITUTION_UPDATED: "Institution updated",
    MATURITY_SCAN_RUN: "Maturity scan",
    AUDIT_CHAIN_VERIFIED: "Audit chain verified",
    ALERT_ACKNOWLEDGED: "Alert acknowledged",
  };
  return labels[action] ?? sentenceCase(action);
}
