import {
  Building2,
  CalendarClock,
  Database,
  FileSearch,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../components/Toast";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingRows,
  Modal,
  Pagination,
  Panel,
  SelectField,
  TableShell,
  Tabs,
  TextField,
  tdClass,
  thClass,
} from "../components/ui";
import { api, toQuery } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_LABELS, formatDateTime } from "../lib/format";
import type {
  AuditChainResult,
  Institution,
  IntegrationStatus,
  MaturityScanResult,
  Paginated,
  Role,
  User,
} from "../lib/types";

const ROLES: Role[] = [
  "INSTITUTION_ADMIN",
  "REVIEWING_OFFICER",
  "APPROVING_OFFICER",
  "AUDITOR",
  "SYSTEM_ADMIN",
];

type TabKey = "users" | "institutions" | "integrations";

/* ------------------------------- users ---------------------------------- */

function UserEditDialog({
  target,
  institutions,
  onClose,
  onSaved,
}: {
  target: User;
  institutions: Institution[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [role, setRole] = useState<Role>(target.role);
  const [institutionId, setInstitutionId] = useState(target.institution?.id ?? "");
  const [active, setActive] = useState(target.is_active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  const submit = async () => {
    if (role === "INSTITUTION_ADMIN" && !institutionId) {
      setFieldError("Choose the institution this administrator belongs to.");
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { role, is_active: active };
      if (role === "INSTITUTION_ADMIN") body.institution_id = institutionId;
      else if (target.role === "INSTITUTION_ADMIN") body.institution_id = null;
      await api.patch<User>(`/admin/users/${target.id}`, body);
      toast.success(`${target.name} updated. The change is in the audit trail.`);
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update this user.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${target.name}`}
      description={target.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <SelectField
          label="Role"
          id="user-role"
          value={role}
          onChange={(event) => setRole(event.target.value as Role)}
          hint="Changing a role revokes the user's active sessions."
        >
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </SelectField>

        {role === "INSTITUTION_ADMIN" ? (
          <SelectField
            label="Institution"
            id="user-institution"
            value={institutionId}
            error={fieldError}
            onChange={(event) => {
              setInstitutionId(event.target.value);
              setFieldError(undefined);
            }}
            required
          >
            <option value="">Select an institution</option>
            {institutions.map((institution) => (
              <option key={institution.id} value={institution.id}>
                {institution.name} ({institution.institution_code})
              </option>
            ))}
          </SelectField>
        ) : (
          <p className="rounded-md border border-line bg-canvas px-3 py-2 text-xs leading-5 text-muted">
            This is a global role. It is not linked to a single institution and applies across all
            participating institutions.
          </p>
        )}

        <div>
          <label htmlFor="user-active" className="flex items-center gap-2 text-[13px] font-medium">
            <input
              id="user-active"
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="h-4 w-4 rounded border-line"
            />
            Account active
          </label>
          <p className="mt-1 text-xs leading-5 text-muted">
            Deactivating revokes active sessions. An account cannot be deleted here; history stays
            attributable.
          </p>
        </div>

        {target.id && (
          <p className="text-[11px] leading-5 text-muted">
            Your own role and activation state cannot be changed from this screen.
          </p>
        )}
      </div>
    </Modal>
  );
}

/* --------------------------- institutions ------------------------------- */

function InstitutionDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Institution | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const editing = Boolean(target);
  const [code, setCode] = useState(target?.institution_code ?? "");
  const [name, setName] = useState(target?.name ?? "");
  const [email, setEmail] = useState(target?.contact_email ?? "");
  const [status, setStatus] = useState(target?.status ?? "ACTIVE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing && target) {
        await api.patch<Institution>(`/institutions/${target.id}`, {
          name: name.trim(),
          contact_email: email.trim(),
          status,
        });
        toast.success("Institution updated and recorded in the audit trail.");
      } else {
        await api.post<Institution>("/institutions", {
          institution_code: code.trim(),
          name: name.trim(),
          contact_email: email.trim(),
        });
        toast.success("Institution added and recorded in the audit trail.");
      }
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this institution.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit institution" : "Add institution"}
      description="Institutions are referenced by every FDR record and drive access scope."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void submit()}
            disabled={!name.trim() || !email.trim() || (!editing && code.trim().length < 3)}
          >
            {editing ? "Save changes" : "Add institution"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label="Institution code"
          id="institution-code"
          value={code}
          disabled={editing}
          required
          placeholder="e.g. NIT-TRICHY"
          hint={editing ? "The code is immutable once created." : "3–32 letters, digits or hyphens."}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
        />
        <TextField
          label="Institution name"
          id="institution-name"
          value={name}
          required
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Contact email"
          id="institution-email"
          type="email"
          value={email}
          required
          onChange={(event) => setEmail(event.target.value)}
        />
        {editing && (
          <SelectField
            label="Status"
            id="institution-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            hint="Inactive institutions keep their records but should not receive new submissions."
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </SelectField>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------- page ---------------------------------- */

function IntegrationsPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<MaturityScanResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<AuditChainResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.get<IntegrationStatus>("/admin/integrations"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load integration status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runScan = async () => {
    setScanning(true);
    try {
      const result = await api.post<MaturityScanResult>("/admin/jobs/maturity-scan");
      setScan(result);
      toast.success(
        `Scan complete: ${result.alerts_created} new alert(s) across ${result.scanned} records.`,
      );
      await load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The scan could not run.");
    } finally {
      setScanning(false);
    }
  };

  const verify = async () => {
    setVerifying(true);
    try {
      const result = await api.post<AuditChainResult>("/admin/audit/verify-chain");
      setVerification(result);
      toast[result.valid ? "success" : "error"](
        result.valid ? `Chain intact across ${result.checked} events.` : "Chain verification failed.",
      );
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  if (loading && !status) {
    return (
      <Panel title="Integration status">
        <LoadingRows rows={5} label="Loading integration status" />
      </Panel>
    );
  }

  if (error || !status) {
    return (
      <Panel title="Integration status">
        <ErrorState message={error ?? "Status unavailable."} onRetry={() => void load()} />
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <InlineAlert tone="warning" title="Nothing here is a production integration">
        Bank verification is {status.bank_verification.simulated ? "SIMULATED" : "manual only"}.
        Simulated responses are stored as simulation-only evidence and never mark a record as
        independently verified.
      </InlineAlert>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Bank verification"
          actions={
            <Badge tone={status.bank_verification.simulated ? "warning" : "neutral"}>
              {status.bank_verification.simulated ? "Simulated" : "Manual"}
            </Badge>
          }
        >
          <p className="text-sm font-medium">{status.bank_verification.label}</p>
          <p className="mt-1 text-xs leading-5 text-muted">{status.bank_verification.detail}</p>
          <p className="mt-2 text-[11px] text-muted">
            Production ready: {status.bank_verification.production_ready ? "yes" : "no"}
          </p>
        </Panel>

        <Panel title="Document extraction" actions={<Badge tone="neutral">Real, not OCR</Badge>}>
          <p className="text-sm font-medium">Engine: {status.extraction.engine}</p>
          <p className="mt-1 text-xs leading-5 text-muted">{status.extraction.detail}</p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
            <FileSearch size={12} aria-hidden />
            Image OCR available: {status.extraction.image_ocr_available ? "yes" : "no"}
          </p>
        </Panel>

        <Panel title="Document storage" actions={<Badge tone="success">Private</Badge>}>
          <ul className="space-y-1.5 text-xs leading-5 text-muted">
            <li className="flex items-center gap-1.5">
              <Database size={12} aria-hidden />
              Private server-side storage:{" "}
              {status.storage.private_server_storage ? "yes" : "no"}
            </li>
            <li>Max upload: {status.storage.max_upload_mb} MB</li>
            <li>
              Malware scanning:{" "}
              <span className="font-medium text-warning">{status.storage.malware_scanning}</span>
            </li>
          </ul>
        </Panel>

        <Panel title="Email delivery" actions={<Badge tone="neutral">Not configured</Badge>}>
          <p className="flex items-center gap-1.5 text-xs leading-5 text-muted">
            <Mail size={12} aria-hidden />
            {status.email_delivery.detail}
          </p>
        </Panel>
      </div>

      <Panel
        title="Maturity scheduler"
        description={`Runs daily at ${status.scheduler.hour_utc
          .toString()
          .padStart(2, "0")}:00 UTC for ${status.scheduler.timezone}.`}
        actions={
          <Button
            size="sm"
            variant="secondary"
            loading={scanning}
            onClick={() => void runScan()}
            icon={<CalendarClock size={14} aria-hidden />}
          >
            Run scan now
          </Button>
        }
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted">Enabled</dt>
            <dd>{status.scheduler.enabled ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted">Thresholds</dt>
            <dd>{status.scheduler.thresholds.join(", ")} days + overdue</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted">Alert policy</dt>
            <dd>{status.scheduler.alert_policy_version}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-muted">Last run</dt>
            <dd>{formatDateTime(status.scheduler.last_run_at)}</dd>
          </div>
        </dl>
        <p className="mt-3 border-t border-line pt-3 text-[11px] leading-5 text-muted">
          The scheduler runs inside this process only. Multiple API instances would each need their
          own leader election or an external scheduler; alert de-duplication keeps the alerts
          idempotent regardless.
        </p>
        {scan && (
          <div className="mt-3">
            <InlineAlert tone="success" title="Scan finished">
              {scan.scanned} records scanned, {scan.alerts_created} new alerts,{" "}
              {scan.alerts_existing} already present, {scan.transitions} lifecycle transitions,{" "}
              {scan.expired} expired. Policy {scan.policy_version}.
            </InlineAlert>
          </div>
        )}
      </Panel>

      <Panel
        title="Audit integrity"
        actions={
          <Button
            size="sm"
            variant="secondary"
            loading={verifying}
            onClick={() => void verify()}
            icon={<ShieldCheck size={14} aria-hidden />}
          >
            Verify chain
          </Button>
        }
      >
        {verification ? (
          <InlineAlert
            tone={verification.valid ? "success" : "danger"}
            title={verification.valid ? "Hash chain intact" : "Hash chain broken"}
          >
            {verification.valid
              ? `${verification.checked} events verified. `
              : `Failed at sequence ${verification.broken_sequence}: ${verification.reason}. `}
            {verification.limitation}
          </InlineAlert>
        ) : (
          <p className="text-xs leading-5 text-muted">
            Recompute the SHA-256 chain across all audit events. Full history, filters and exports
            live in the <Link to="/app/audit" className="text-primary hover:underline">audit trail</Link>.
          </p>
        )}
      </Panel>

      <Panel title="Runtime">
        <p className="text-xs leading-5 text-muted">
          Database dialect: <strong className="font-medium text-ink">{status.database.dialect}</strong>
          . Production target: {status.database.production_target}. Local development may run on
          SQLite while production is expected on PostgreSQL; see the README for the supported setup.
        </p>
        <p className="mt-2 text-[11px] text-muted">
          API reference is served at <span className="font-mono">/api/docs</span> when the backend is
          running.
        </p>
      </Panel>
    </div>
  );
}

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>("users");

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<Paginated<User> | null>(null);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<User | null>(null);

  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institutionsError, setInstitutionsError] = useState<string | null>(null);
  const [editInstitution, setEditInstitution] = useState<Institution | null | undefined>(undefined);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      setUsers(
        await api.get<Paginated<User>>(
          `/admin/users${toQuery({ search, page, page_size: 20 })}`,
        ),
      );
    } catch (caught) {
      setUsersError(caught instanceof Error ? caught.message : "Could not load users.");
    } finally {
      setUsersLoading(false);
    }
  }, [search, page]);

  const loadInstitutions = useCallback(async () => {
    try {
      const response = await api.get<{ items: Institution[] }>("/institutions");
      setInstitutions(response.items);
      setInstitutionsError(null);
    } catch (caught) {
      setInstitutionsError(
        caught instanceof Error ? caught.message : "Could not load institutions.",
      );
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    void loadInstitutions();
  }, [loadInstitutions]);

  const activeUsers = users?.items.filter((item) => item.is_active).length ?? 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Manage users, roles and the institution registry, and inspect integration status.
            Administrative changes are audited and never alter financial decisions silently.
          </p>
        </div>
      </header>

      <Tabs
        label="Administration sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "users", label: "Users", count: users?.total },
          { value: "institutions", label: "Institutions", count: institutions.length },
          { value: "integrations", label: "Integrations" },
        ]}
      />

      {tab === "users" && (
        <Panel bodyClassName="p-0">
          <div className="flex flex-col gap-2 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
            <form
              className="flex flex-1 gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setSearch(searchInput.trim());
              }}
            >
              <label htmlFor="user-search" className="sr-only">
                Search users by name or email
              </label>
              <input
                id="user-search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search name or email"
                className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm placeholder:text-muted/70 focus:border-primary focus:outline-none"
              />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadUsers()}
              loading={usersLoading}
              icon={<RefreshCw size={14} aria-hidden />}
            >
              Refresh
            </Button>
          </div>

          {usersError ? (
            <div className="p-4">
              <ErrorState message={usersError} onRetry={() => void loadUsers()} />
            </div>
          ) : usersLoading && !users ? (
            <div className="p-4">
              <LoadingRows rows={6} label="Loading users" />
            </div>
          ) : users && users.items.length === 0 ? (
            <EmptyState
              icon={<UsersRound size={20} aria-hidden />}
              title="No users match"
              description="Adjust the search, or check that accounts were provisioned by the operator."
            />
          ) : users ? (
            <>
              <TableShell caption="User accounts">
                <thead>
                  <tr>
                    <th className={thClass}>Name</th>
                    <th className={thClass}>Role</th>
                    <th className={thClass}>Institution</th>
                    <th className={thClass}>Status</th>
                    <th className={thClass}>Last sign-in</th>
                    <th className={thClass}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {users.items.map((item) => {
                    const isSelf = item.id === user?.id;
                    return (
                      <tr key={item.id} className="hover:bg-canvas/60">
                        <td className={tdClass}>
                          <p className="text-[13px] font-medium">
                            {item.name}
                            {isSelf && (
                              <span className="ml-1.5 text-[10px] uppercase text-muted">you</span>
                            )}
                          </p>
                          <p className="text-[11px] text-muted">{item.email}</p>
                        </td>
                        <td className={`${tdClass} text-xs`}>{ROLE_LABELS[item.role]}</td>
                        <td className={`${tdClass} text-xs text-muted`}>
                          {item.institution?.name ?? "All institutions"}
                        </td>
                        <td className={tdClass}>
                          <Badge tone={item.is_active ? "success" : "neutral"}>
                            {item.is_active ? "Active" : "Deactivated"}
                          </Badge>
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-xs text-muted`}>
                          {formatDateTime(item.last_login_at)}
                        </td>
                        <td className={tdClass}>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isSelf}
                            title={
                              isSelf
                                ? "You cannot change your own role or deactivate your own account."
                                : "Edit this account"
                            }
                            onClick={() => setEditUser(item)}
                            icon={<Pencil size={13} aria-hidden />}
                          >
                            Edit
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableShell>
              <Pagination
                page={users.page}
                pages={users.pages}
                total={users.total}
                pageSize={users.page_size}
                busy={usersLoading}
                onPage={(next) => setPage(next)}
              />
            </>
          ) : null}

          <p className="border-t border-line px-4 py-2.5 text-[11px] text-muted sm:px-5">
            {users ? `${activeUsers} active of ${users.items.length} shown` : "—"} · accounts cannot
            be deleted, only deactivated, so history stays attributable.
          </p>
        </Panel>
      )}

      {tab === "institutions" && (
        <Panel
          title="Institution registry"
          description="Every FDR belongs to exactly one institution. Institutional users only see their own."
          actions={
            <Button
              size="sm"
              variant="primary"
              onClick={() => setEditInstitution(null)}
              icon={<Plus size={14} aria-hidden />}
            >
              Add institution
            </Button>
          }
          bodyClassName="p-0"
        >
          {institutionsError ? (
            <div className="p-4">
              <ErrorState message={institutionsError} onRetry={() => void loadInstitutions()} />
            </div>
          ) : institutions.length === 0 ? (
            <EmptyState
              icon={<Building2 size={20} aria-hidden />}
              title="No institutions yet"
              description="Add the first participating institution to start tracking deposits."
            />
          ) : (
            <TableShell caption="Institutions">
              <thead>
                <tr>
                  <th className={thClass}>Institution</th>
                  <th className={thClass}>Code</th>
                  <th className={thClass}>Contact</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Created</th>
                  <th className={thClass}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {institutions.map((institution) => (
                  <tr key={institution.id} className="hover:bg-canvas/60">
                    <td className={tdClass}>
                      <p className="text-[13px] font-medium">{institution.name}</p>
                    </td>
                    <td className={`${tdClass} font-mono text-[11px] text-muted`}>
                      {institution.institution_code}
                    </td>
                    <td className={`${tdClass} text-xs text-muted`}>
                      {institution.contact_email}
                    </td>
                    <td className={tdClass}>
                      <Badge tone={institution.status === "ACTIVE" ? "success" : "neutral"}>
                        {institution.status === "ACTIVE" ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-xs text-muted`}>
                      {formatDateTime(institution.created_at)}
                    </td>
                    <td className={tdClass}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditInstitution(institution)}
                        icon={<Pencil size={13} aria-hidden />}
                      >
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
          <p className="border-t border-line px-4 py-2.5 text-[11px] text-muted sm:px-5">
            Institution codes are immutable. This prototype does not provision accounts for an
            institution automatically.
          </p>
        </Panel>
      )}

      {tab === "integrations" && <IntegrationsPanel />}

      {editUser && (
        <UserEditDialog
          target={editUser}
          institutions={institutions}
          onClose={() => setEditUser(null)}
          onSaved={loadUsers}
        />
      )}

      {editInstitution !== undefined && (
        <InstitutionDialog
          target={editInstitution}
          onClose={() => setEditInstitution(undefined)}
          onSaved={loadInstitutions}
        />
      )}
    </div>
  );
}
