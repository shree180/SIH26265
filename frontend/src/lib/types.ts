export type Role =
  | "INSTITUTION_ADMIN"
  | "REVIEWING_OFFICER"
  | "APPROVING_OFFICER"
  | "AUDITOR"
  | "SYSTEM_ADMIN";

export type LifecycleStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "CORRECTION_REQUIRED"
  | "REJECTED"
  | "VERIFIED"
  | "ACTIVE"
  | "MATURING"
  | "RENEWAL_PENDING"
  | "REPLACED"
  | "RELEASE_REQUESTED"
  | "PENDING_CHECKER"
  | "RELEASED"
  | "EXPIRED";

export type VerificationStatus =
  | "UNVERIFIED"
  | "MANUAL_CONFIRMED"
  | "SIMULATION_ONLY"
  | "MISMATCH_REPORTED"
  | "FAILED_VERIFICATION";

export interface InstitutionRef {
  id: string;
  name: string;
  institution_code: string;
}

export interface Institution {
  id: string;
  institution_code: string;
  name: string;
  contact_email: string;
  status: string;
  created_at: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  institution: InstitutionRef | null;
  last_login_at: string | null;
}

export interface Capabilities {
  can_manage_users: boolean;
  can_review: boolean;
  can_decide_release: boolean;
  can_submit: boolean;
  read_only: boolean;
}

export interface MeResponse {
  user: User;
  unread_notifications: number;
  capabilities: Capabilities;
  csrf_token?: string;
  access_expires_at?: string;
}

export interface PriorityFactor {
  code: string;
  label: string;
  weight: number;
  detail: string;
}

export interface Priority {
  score: number;
  summary: string;
  rule_version: string;
  factors: PriorityFactor[];
}

export interface FdrSummary {
  id: string;
  reference_number: string;
  institution: InstitutionRef | null;
  bank_name: string;
  bank_code: string | null;
  amount: string;
  currency: string;
  issue_date: string;
  maturity_date: string;
  days_remaining: number;
  lifecycle_status: LifecycleStatus;
  status_label: string;
  verification_status: VerificationStatus;
  priority: Priority;
  has_documents: boolean;
  document_count: number;
  discrepancy_count: number;
  unresolved_discrepancies: number;
  pending_release_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Extraction {
  id: string;
  field_name: string;
  kind: "text" | "money" | "date";
  extracted_value: string | null;
  confidence: number | null;
  page_number: number | null;
  review_status: "PENDING" | "CONFIRMED" | "CORRECTED" | "DISMISSED";
  reviewed_at: string | null;
  corrected_value: string | null;
}

export interface DocumentInfo {
  id: string;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  document_type: string;
  sha256_digest: string;
  uploaded_at: string;
  scan_status: string;
  extraction_status: string;
  extraction_engine: string | null;
  extraction_note: string | null;
  extracted_at: string | null;
  download_url: string;
  extractions: Extraction[];
}

export type DiscrepancyStatus =
  | "MATCH"
  | "MISMATCH"
  | "MISSING_IN_DOCUMENT"
  | "REVIEWED_MATCH"
  | "REVIEWED_OVERRIDE"
  | "DISMISSED"
  | "LOW_CONFIDENCE";

export interface Discrepancy {
  field: string;
  label: string;
  kind: "text" | "money" | "date";
  submitted_value: string;
  extracted_value: string | null;
  corrected_value: string | null;
  confidence: number | null;
  status: DiscrepancyStatus;
  review_status: string | null;
  resolved: boolean;
  extraction_id: string | null;
  document_id: string | null;
  document_name: string | null;
  note: string | null;
}

export interface WorkflowEvent {
  id: string;
  action: string;
  from_state: string | null;
  to_state: string | null;
  reason: string | null;
  actor_label: string;
  created_at: string;
}

export interface VerificationCheck {
  id: string;
  method: "MANUAL" | "PROVIDER";
  provider: string;
  result: string;
  checked_at: string;
  checked_by: string | null;
  evidence_reference: string | null;
  notes: string | null;
  simulated: boolean;
}

export interface ReleaseRequester {
  id: string;
  name: string;
  email: string;
}

export interface ReleaseRequest {
  id: string;
  fdr_id: string;
  fdr_reference: string | null;
  institution_name: string | null;
  requested_by: ReleaseRequester | null;
  request_reason: string;
  status: "PENDING_CHECKER" | "APPROVED" | "REJECTED" | "RETURNED";
  checker: ReleaseRequester | null;
  decision_reason: string | null;
  previous_lifecycle_state: string;
  requested_at: string;
  decided_at: string | null;
  version: number;
  approval_overdue: boolean;
}

export interface AuditEvent {
  id: string;
  sequence: number;
  actor_label: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  action: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  previous_hash: string;
  event_hash: string;
}

export interface RenewalSummary {
  id: string;
  reference_number: string;
  lifecycle_status: LifecycleStatus;
  relationship_type: string;
  created_at: string;
}

export interface RenewalInfo {
  predecessor: RenewalSummary | null;
  successors: RenewalSummary[];
  is_renewal_successor: boolean;
}

export interface Permissions {
  role: Role;
  is_institution_user: boolean;
  can_edit: boolean;
  can_upload_document: boolean;
  can_extract: boolean;
  can_review_extractions: boolean;
  can_record_verification: boolean;
  can_request_release: boolean;
  can_renew: boolean;
  can_decide_release: boolean;
  pending_release_id: string | null;
}

export interface AvailableTransition {
  action: string;
  label: string;
}

export interface FdrDetail extends FdrSummary {
  notes: string | null;
  created_by: { id: string; name: string } | null;
  submitted_at: string | null;
  verified_at: string | null;
  activated_at: string | null;
  released_at: string | null;
  released_by: string | null;
  documents: DocumentInfo[];
  discrepancies: Discrepancy[];
  workflow_events: WorkflowEvent[];
  verification_checks: VerificationCheck[];
  release_requests: ReleaseRequest[];
  audit_events: AuditEvent[];
  renewal: RenewalInfo;
  available_transitions: AvailableTransition[];
  permissions: Permissions;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  computed_in_memory?: boolean;
}

export type WorkspaceTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

/** A counted, linked call to action on a role workspace. */
export interface WorkspaceActionItem {
  key: string;
  label: string;
  count: number;
  detail: string;
  to: string;
  tone: WorkspaceTone;
}

/** A release request as a checker sees it: evidence, maker and age. */
export interface ReleaseQueueItem {
  id: string;
  fdr_id: string;
  reference_number: string;
  institution_name: string | null;
  amount: string;
  currency: string;
  lifecycle_status: LifecycleStatus;
  status: string;
  status_label: string;
  maker_name: string;
  maker_id: string;
  age_hours: number;
  requested_at: string;
  decided_at: string | null;
  request_reason: string;
  decision_reason: string | null;
  document_count: number;
  version: number;
}

interface WorkspaceBase {
  role: Role;
  title: string;
  question: string;
  generated_at: string;
  next_step: string;
}

export interface InstitutionWorkspace extends WorkspaceBase {
  kind: "INSTITUTION";
  action_items: WorkspaceActionItem[];
  upcoming_maturities: FdrSummary[];
  recent_submissions: FdrSummary[];
  release_requests: ReleaseQueueItem[];
  extraction_health: {
    documents: number;
    extracted: number;
    needs_review: number;
    unavailable: number;
    pending: number;
    unreviewed_fields: number;
  };
}

export interface ReviewerWorkspace extends WorkspaceBase {
  kind: "REVIEWER";
  review_inbox: FdrSummary[];
  inbox_reasons: Record<string, string[]>;
  counts: {
    awaiting_decision: number;
    resubmitted_after_correction: number;
    missing_evidence: number;
    unresolved_discrepancies: number;
    overdue_beyond_sla: number;
    urgent_maturity: number;
  };
  discrepancy_worklist: FdrSummary[];
  correction_resubmissions: FdrSummary[];
  maturity_risk: FdrSummary[];
  review_sla_hours: number;
}

export interface CheckerWorkspace extends WorkspaceBase {
  kind: "CHECKER";
  awaiting_decision: ReleaseQueueItem[];
  own_raised_requests: ReleaseQueueItem[];
  decided_by_you: ReleaseQueueItem[];
  counts: {
    awaiting_your_decision: number;
    raised_by_you_blocked: number;
    decided_by_you: number;
    beyond_sla: number;
  };
  approval_sla_hours: number;
  eligibility: {
    requires_manual_verification: boolean;
    requires_evidence: boolean;
    self_approval_blocked: boolean;
    note: string;
  };
}

export interface AuditorTransition {
  id: string;
  fdr_id: string;
  reference_number: string;
  institution_name: string | null;
  action: string;
  action_label: string;
  from_state: string | null;
  from_label: string | null;
  to_state: string | null;
  to_label: string | null;
  actor_label: string;
  reason: string | null;
  created_at: string;
}

export interface AuditorWorkspace extends WorkspaceBase {
  kind: "AUDITOR";
  coverage: {
    records_in_scope: number;
    institutions_in_scope: number;
    closed_records: number;
    unresolved_discrepancies: number;
  };
  checks: {
    simulated_checks: number;
    manual_checks: number;
    manually_confirmed_records: number;
    provider_only_records: number;
  };
  recent_transitions: AuditorTransition[];
  chain_check: {
    last_checked_at: string | null;
    checked_by: string | null;
    valid: boolean | null;
    checked: number | null;
    broken_sequence: number | null;
  };
  read_only: boolean;
  limitation: string;
}

export interface SystemAdminWorkspace extends WorkspaceBase {
  kind: "SYSTEM_ADMIN";
  accounts: {
    total: number;
    active: number;
    inactive: number;
    by_role: { role: Role; count: number }[];
    active_sessions: number;
    locked_or_throttled: number;
    accounts_with_failed_attempts: number;
  };
  scheduler: {
    enabled: boolean;
    hour_utc: number;
    thresholds: number[];
    timezone: string;
    last_run_at: string | null;
    last_run: Record<string, unknown>;
    single_instance_only: boolean;
  };
  delivery: { in_app: number; failed: number; pending: number; email_configured: boolean };
  extraction: {
    documents: number;
    unavailable: number;
    pending: number;
    image_ocr_available: boolean;
  };
  integrations: { key: string; label: string; state: string; production_ready: boolean }[];
  chain_check: { last_checked_at: string | null };
  release_queue: ReleaseQueueItem[];
  records_in_scope: number;
  recent_admin_events: AuditEvent[];
}

export type RoleWorkspace =
  | InstitutionWorkspace
  | ReviewerWorkspace
  | CheckerWorkspace
  | AuditorWorkspace
  | SystemAdminWorkspace;

export interface DashboardSummary {
  metrics: {
    total_fdrs: number;
    active: number;
    pending_review: number;
    correction_required: number;
    upcoming_maturity: number;
    overdue: number;
    discrepancies: number;
    missing_evidence: number;
    pending_release_approvals: number;
    released: number;
    verified: number;
    own_pending_release_requests: number;
  };
  needs_attention: FdrSummary[];
  maturity_buckets: { key: string; label: string; count: number }[];
  recent_activity: AuditEvent[];
  scope: {
    role: Role;
    is_global: boolean;
    label: string | null;
    institution: InstitutionRef | null;
  };
  generated_at: string;
  business_date: string;
  truncated: boolean;
  workspace: RoleWorkspace;
}

export interface NotificationItem {
  id: string;
  fdr_id: string;
  fdr_reference: string | null;
  alert_type: string;
  threshold_days: number | null;
  message: string;
  channel: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  acknowledged_at: string | null;
  delivery_reference: string | null;
  error_summary: string | null;
}

export interface NotificationList {
  items: NotificationItem[];
  unread_count: number;
}

export interface DiscrepancyResponse {
  fdr_id: string;
  reference_number: string;
  amount: string;
  fields: Discrepancy[];
  unresolved: number;
  summary: string | null;
  has_extraction: boolean;
}

export interface IntegrationStatus {
  bank_verification: {
    mode: string;
    label: string;
    simulated: boolean;
    production_ready: boolean;
    detail: string;
  };
  extraction: { engine: string; image_ocr_available: boolean; detail: string };
  storage: { private_server_storage: boolean; max_upload_mb: number; malware_scanning: string };
  scheduler: {
    enabled: boolean;
    single_instance_only: boolean;
    hour_utc: number;
    thresholds: number[];
    timezone: string;
    alert_policy_version: string;
    last_run_at: string | null;
    last_run: Record<string, unknown>;
  };
  email_delivery: { configured: boolean; detail: string };
  database: { dialect: string; production_target: string };
}

export interface AuditChainResult {
  valid: boolean;
  checked: number;
  broken_event_id: string | null;
  broken_sequence: number | null;
  reason: string | null;
  checked_at: string;
  chain_head: string | null;
  limitation: string;
}

export interface MaturityScanResult {
  scanned: number;
  alerts_created: number;
  alerts_existing: number;
  transitions: number;
  expired: number;
  skipped_no_recipient: number;
  policy_version: string;
  run_at: string;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface Meta {
  app_name: string;
  environment: string;
  business_timezone: string;
  maturity_thresholds: number[];
  lifecycle_statuses: { value: LifecycleStatus; label: string }[];
  roles: { value: Role; label: string }[];
  verification: {
    mode: string;
    simulated: boolean;
    label: string;
  };
  extraction: { pdf_text_layer: boolean; image_ocr: boolean; label: string };
  alert_policy: string;
  export_row_cap: number;
  disclaimer: string;
}
