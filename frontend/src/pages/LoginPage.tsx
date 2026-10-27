import {
  ArrowRight,
  CalendarClock,
  Eye,
  EyeOff,
  FileSearch,
  History,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_LABELS } from "../lib/format";
import { Button, InlineAlert, TextField } from "../components/ui";

const DEMO_ACCOUNTS = [
  { email: "inst.admin@dit.demo", role: "INSTITUTION_ADMIN" as const },
  { email: "reviewer@fdr.demo", role: "REVIEWING_OFFICER" as const },
  { email: "checker@fdr.demo", role: "APPROVING_OFFICER" as const },
  { email: "auditor@fdr.demo", role: "AUDITOR" as const },
  { email: "sysadmin@fdr.demo", role: "SYSTEM_ADMIN" as const },
];

const DEMO_PASSWORD = "Sentinel#2026";

const FEATURES = [
  {
    icon: FileSearch,
    title: "Evidence-linked review",
    text: "Compare submitted values with document extraction, field by field.",
  },
  {
    icon: CalendarClock,
    title: "Deduplicated maturity alerts",
    text: "30, 15 and 7 day thresholds plus overdue, generated once per record.",
  },
  {
    icon: LockKeyhole,
    title: "Maker-checker release",
    text: "Release decisions require a different authorised officer.",
  },
  {
    icon: History,
    title: "Tamper-evident history",
    text: "Hash-chained audit events with an integrity check and stated limits.",
  },
];

export default function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const expired = Boolean((location.state as { expired?: boolean } | null)?.expired);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Loader2 className="animate-spin text-primary" size={22} aria-hidden />
        <span className="sr-only">Checking your session</span>
      </div>
    );
  }

  if (user) return <Navigate to="/app/overview" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setHint(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setHint(caught.hint ?? null);
      } else {
        setError("Sign-in failed. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(480px,560px)]">
      <div className="relative hidden flex-col justify-between bg-primary px-10 py-10 text-white lg:flex xl:px-14">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10">
              <ShieldCheck size={19} aria-hidden />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">FDR Sentinel</span>
          </div>

          <h1 className="mt-14 max-w-[19ch] text-[34px] font-semibold leading-[1.15] tracking-tight xl:text-[40px]">
            Every security deposit, accounted for.
          </h1>
          <p className="mt-4 max-w-[46ch] text-[15px] leading-7 text-white/75">
            A single workspace for FDR records, evidence, review decisions, maturity
            monitoring and controlled release.
          </p>

          <dl className="mt-10 grid max-w-lg grid-cols-1 gap-5 sm:grid-cols-2">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="border-t border-white/15 pt-3.5">
                <feature.icon size={17} className="text-white/70" aria-hidden />
                <dt className="mt-2 text-[13px] font-medium">{feature.title}</dt>
                <dd className="mt-1 text-[12px] leading-5 text-white/60">{feature.text}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="max-w-lg border-t border-white/15 pt-4">
          <p className="text-[11px] leading-5 text-white/55">
            Prototype for SIH26265. Synthetic demonstration data only. No authorised bank
            integration exists, so the system does not verify FDR authenticity and no funds move.
          </p>
        </div>
      </div>

      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-white">
              <ShieldCheck size={17} aria-hidden />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">FDR Sentinel</span>
          </div>

          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Use your institutional account. Access is limited to your role and institution.
          </p>

          {expired && !error && (
            <div className="mt-4">
              <InlineAlert tone="warning" title="Session ended">
                Sign in again to continue.
              </InlineAlert>
            </div>
          )}
          {error && (
            <div className="mt-4">
              <InlineAlert tone="danger" title="Could not sign in">
                {error}
                {hint ? ` ${hint}` : ""}
              </InlineAlert>
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <TextField
              id="email"
              label="Email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@institution.example"
            />
            <div className="relative">
              <TextField
                id="password"
                label="Password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="[&_input]:pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2.5 top-[30px] rounded p-1 text-muted hover:text-ink"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              </button>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={submitting}
              disabled={!email.trim() || !password}
            >
              Sign in
              {!submitting && <ArrowRight size={15} aria-hidden />}
            </Button>
          </form>

          {import.meta.env.DEV && (
            <details className="mt-7 rounded-md border border-line bg-surface px-3.5 py-3">
              <summary className="cursor-pointer text-[13px] font-medium text-ink">
                Development demo accounts
              </summary>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                Seeded synthetic accounts. Development only — never enable demo accounts in
                production. Shared password:{" "}
                <code className="rounded bg-canvas px-1 py-0.5 text-[11px]">{DEMO_PASSWORD}</code>
              </p>
              <ul className="mt-2 divide-y divide-line">
                {DEMO_ACCOUNTS.map((account) => (
                  <li key={account.email} className="flex items-center justify-between gap-3 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] text-ink">{account.email}</p>
                      <p className="text-[10px] text-muted">{ROLE_LABELS[account.role]}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      icon={<UserCog size={13} aria-hidden />}
                      onClick={() => {
                        setEmail(account.email);
                        setPassword(DEMO_PASSWORD);
                        setError(null);
                      }}
                    >
                      Use
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
