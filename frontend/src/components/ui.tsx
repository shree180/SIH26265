import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Info,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  DISCREPANCY_LABELS,
  DISCREPANCY_TONES,
  STATUS_LABELS,
  STATUS_TONES,
  VERIFICATION_LABELS,
  VERIFICATION_TONES,
  daysLabel,
  daysTone,
  priorityLabel,
  priorityTone,
} from "../lib/format";
import type { Tone } from "../lib/format";
import type {
  DiscrepancyStatus,
  LifecycleStatus,
  Priority,
  VerificationStatus,
} from "../lib/types";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

const toneClasses: Record<Tone, string> = {
  neutral: "border-line bg-canvas text-muted",
  info: "border-info/20 bg-info/10 text-info",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-danger/25 bg-danger/10 text-danger",
  accent: "border-accent/25 bg-accent/10 text-accent",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-medium leading-5 whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: LifecycleStatus | string }) {
  const key = status as LifecycleStatus;
  return <Badge tone={STATUS_TONES[key] ?? "neutral"}>{STATUS_LABELS[key] ?? String(status)}</Badge>;
}

export function VerificationBadge({ status }: { status: VerificationStatus | string }) {
  const key = status as VerificationStatus;
  return (
    <Badge tone={VERIFICATION_TONES[key] ?? "neutral"}>
      {VERIFICATION_LABELS[key] ?? String(status)}
    </Badge>
  );
}

export function DiscrepancyBadge({ status }: { status: DiscrepancyStatus }) {
  return (
    <Badge tone={DISCREPANCY_TONES[status] ?? "neutral"}>
      {DISCREPANCY_LABELS[status] ?? status}
    </Badge>
  );
}

export function PriorityBadge({ priority, showLabel = true }: { priority: Priority; showLabel?: boolean }) {
  return (
    <span
      title={priority.summary}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-medium tnum",
        toneClasses[priorityTone(priority)],
      )}
    >
      <span>{priority.score}</span>
      {showLabel && <span className="font-normal">{priorityLabel(priority.score)}</span>}
    </span>
  );
}

export function DaysChip({ days }: { days: number }) {
  return (
    <Badge tone={daysTone(days)} className="tnum">
      {daysLabel(days)}
    </Badge>
  );
}

const buttonVariants = {
  primary: "border-transparent bg-primary text-white hover:bg-[#123449]",
  secondary: "border-line bg-surface text-ink hover:bg-canvas",
  ghost: "border-transparent bg-transparent text-ink hover:bg-primary-soft",
  subtle: "border-transparent bg-primary-soft text-primary hover:bg-[#dbe6ee]",
  danger: "border-transparent bg-danger text-white hover:bg-[#921c13]",
} as const;

const buttonSizes = {
  sm: "h-8 gap-1.5 px-2.5 text-[13px]",
  md: "h-9 gap-2 px-3.5 text-sm",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof buttonSizes;
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-md border font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
    >
      {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = "primary",
  size = "md",
  children,
  icon,
  className,
}: {
  to: string;
  variant?: ButtonVariant;
  size?: keyof typeof buttonSizes;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center justify-center rounded-md border font-medium transition-colors duration-150",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("panel hairline", className)}>
      {(title || actions) && (
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>
    </section>
  );
}

const controlBase =
  "w-full rounded-md border bg-surface px-3 text-sm text-ink placeholder:text-muted/70 focus:border-primary focus:outline-none disabled:bg-canvas disabled:text-muted";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs leading-5 text-muted">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs leading-5 text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  id,
  hint,
  error,
  required,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  hint?: ReactNode;
  error?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} required={required} className={className}>
      <input
        {...props}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(controlBase, "h-9", error ? "border-danger" : "border-line")}
      />
    </Field>
  );
}

export function SelectField({
  label,
  id,
  hint,
  error,
  required,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  id: string;
  hint?: ReactNode;
  error?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} required={required} className={className}>
      <select
        {...props}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(controlBase, "h-9", error ? "border-danger" : "border-line")}
      >
        {children}
      </select>
    </Field>
  );
}

export function TextareaField({
  label,
  id,
  hint,
  error,
  required,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  id: string;
  hint?: ReactNode;
  error?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error} required={required} className={className}>
      <textarea
        {...props}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(controlBase, "py-2 leading-6", error ? "border-danger" : "border-line")}
      />
    </Field>
  );
}

export function TableShell({ caption, children }: { caption?: string; children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full min-w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export const thClass =
  "whitespace-nowrap border-b border-line bg-canvas/70 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted";

export const tdClass = "border-b border-line/70 px-4 py-3 align-middle";

export function Pagination({
  page,
  pages,
  total,
  pageSize,
  onPage,
  busy,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  busy?: boolean;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col items-start justify-between gap-3 border-t border-line px-4 py-3 text-xs text-muted sm:flex-row sm:items-center">
      <p className="tnum">
        {total === 0 ? "No records" : `Showing ${start}–${end} of ${total}`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1 || busy}
          aria-label="Previous page"
          icon={<ChevronLeft size={15} aria-hidden />}
        >
          Previous
        </Button>
        <span className="tnum px-1">
          Page {pages === 0 ? 0 : page} of {pages}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages || busy || pages === 0}
          aria-label="Next page"
        >
          Next
          <ChevronRight size={15} aria-hidden />
        </Button>
      </div>
    </div>
  );
}

const modalWidths = {
  sm: "sm:max-w-md",
  md: "sm:max-w-xl",
  lg: "sm:max-w-3xl",
} as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: keyof typeof modalWidths;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "max-h-[92vh] w-full overflow-y-auto rounded-t-[var(--radius-panel)] border border-line bg-surface shadow-xl sm:rounded-[var(--radius-panel)]",
          modalWidths[width],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm leading-6 text-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded p-1.5 text-muted hover:bg-canvas hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.value === value);
    let next = index;
    if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    onChange(tabs[next].value);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex gap-1 overflow-x-auto border-b border-line"
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={value === tab.value}
          tabIndex={value === tab.value ? 0 : -1}
          onClick={() => onChange(tab.value)}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm transition-colors",
            value === tab.value
              ? "border-primary font-medium text-primary"
              : "border-transparent text-muted hover:text-ink",
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="tnum ml-1.5 text-xs text-muted">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function InlineAlert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    info: "border-info/25 bg-info/5 text-ink",
    warning: "border-warning/30 bg-warning/5 text-ink",
    danger: "border-danger/30 bg-danger/5 text-ink",
    success: "border-success/25 bg-success/5 text-ink",
  };
  const icons = {
    info: <Info size={16} className="text-info" aria-hidden />,
    warning: <AlertTriangle size={16} className="text-warning" aria-hidden />,
    danger: <AlertTriangle size={16} className="text-danger" aria-hidden />,
    success: <CheckCircle2 size={16} className="text-success" aria-hidden />,
  };
  return (
    <div className={cn("flex gap-3 rounded-md border px-3.5 py-3 text-sm leading-6", styles[tone])}>
      <span className="mt-0.5 shrink-0">{icons[tone]}</span>
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        <div className={cn(title && "mt-0.5", "text-muted")}>{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-canvas text-muted">
        {icon ?? <Inbox size={20} aria-hidden />}
      </span>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm leading-6 text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-danger/25 bg-danger/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="mt-0.5 text-danger" aria-hidden />
        <div>
          <p className="text-sm font-medium text-ink">Something went wrong</p>
          <p className="mt-0.5 text-sm text-muted">{message}</p>
        </div>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} icon={<RefreshCw size={14} aria-hidden />}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 5, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-2 py-2" role="status" aria-label={label}>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-9 animate-pulse rounded bg-line/60"
          style={{ animationDelay: `${index * 60}ms` }}
        />
      ))}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  to,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  to?: string;
  tone?: Tone;
}) {
  const body = (
    <>
      <p className="text-[12px] font-medium uppercase tracking-[0.05em] text-muted">{label}</p>
      <p className="tnum mt-2 text-2xl font-semibold leading-none text-ink">{value}</p>
      {hint && (
        <p className={cn("mt-2 text-xs", tone === "danger" ? "text-danger" : "text-muted")}>{hint}</p>
      )}
    </>
  );
  const className = cn(
    "panel hairline block px-4 py-3.5 transition-colors",
    to && "hover:border-primary/40 hover:bg-primary-soft/30",
  );
  if (to) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

export function ProvenanceStrip({
  items,
}: {
  items: { label: string; value: string; tone?: Tone; note?: string }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="bg-surface px-3.5 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
            {item.label}
          </p>
          <div className="mt-1.5">
            <Badge tone={item.tone ?? "neutral"}>{item.value}</Badge>
          </div>
          {item.note && <p className="mt-1.5 text-xs leading-5 text-muted">{item.note}</p>}
        </div>
      ))}
    </div>
  );
}

export function DetailGrid({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
            {item.label}
          </dt>
          <dd className="mt-1 break-words text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  label = "Reason",
  hint,
  confirmLabel = "Confirm",
  tone = "primary",
  minLength = 5,
  busy,
  error,
  onSubmit,
  children,
  requireReason = true,
  showReason = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  label?: string;
  hint?: string;
  confirmLabel?: string;
  tone?: ButtonVariant;
  minLength?: number;
  busy?: boolean;
  error?: string;
  onSubmit: (reason: string) => void;
  children?: ReactNode;
  requireReason?: boolean;
  showReason?: boolean;
}) {
  const [reason, setReason] = useState("");
  const id = useId();

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const localError =
    requireReason && reason.trim().length > 0 && reason.trim().length < minLength
      ? `Use at least ${minLength} characters.`
      : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone}
            loading={busy}
            onClick={() => onSubmit(reason.trim())}
            disabled={requireReason && reason.trim().length < minLength}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        {showReason && (
          <TextareaField
            id={id}
            label={requireReason ? label : `${label} (optional)`}
            value={reason}
            rows={4}
            maxLength={2000}
            required={requireReason}
            hint={
              hint ??
              `At least ${minLength} characters. This is recorded in the audit trail.`
            }
            error={localError ?? error}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
        {!showReason && error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Modal>
  );
}
