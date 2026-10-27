import {
  Bell,
  CalendarClock,
  ClipboardCheck,
  Download,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ComponentType } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_LABELS, formatDateTime, initials } from "../lib/format";
import type { Meta, NotificationList, NotificationItem, Role } from "../lib/types";
import { Badge, Button, EmptyState, LoadingRows, cn } from "./ui";
import { useToast } from "./Toast";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean; className?: string }>;
  roles?: Role[];
}

const NAV: NavItem[] = [
  { to: "/app/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/app/fdrs", label: "FDR Records", icon: FileText },
  {
    to: "/app/review-queue",
    label: "Review Queue",
    icon: ClipboardCheck,
    roles: ["REVIEWING_OFFICER"],
  },
  { to: "/app/maturity", label: "Maturity & Alerts", icon: CalendarClock },
  { to: "/app/release-requests", label: "Release Requests", icon: ShieldCheck },
  { to: "/app/reports", label: "Reports", icon: Download },
  { to: "/app/audit", label: "Audit Trail", icon: History },
  {
    to: "/app/admin/users",
    label: "Administration",
    icon: UsersRound,
    roles: ["SYSTEM_ADMIN"],
  },
];

export function AppShell() {
  const { user, signOut, unreadNotifications, setUnreadNotifications } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const location = useLocation();
  const toast = useToast();

  useEffect(() => {
    setMobileOpen(false);
    setBellOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    api
      .get<Meta>("/meta")
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  const loadNotifications = useCallback(async () => {
    setNotificationsLoading(true);
    try {
      const data = await api.get<NotificationList>("/notifications?limit=12");
      setNotifications(data.items);
      setUnreadNotifications(data.unread_count);
    } catch {
      setNotifications([]);
    } finally {
      setNotificationsLoading(false);
    }
  }, [setUnreadNotifications]);

  const openBell = () => {
    const next = !bellOpen;
    setBellOpen(next);
    if (next) void loadNotifications();
  };

  const acknowledge = async (item: NotificationItem) => {
    try {
      await api.post<NotificationItem>(`/notifications/${item.id}/acknowledge`);
      setNotifications((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, acknowledged_at: new Date().toISOString() } : entry,
        ),
      );
      setUnreadNotifications(Math.max(0, unreadNotifications - 1));
      toast.success("Alert acknowledged. The underlying record is unchanged.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not acknowledge the alert.");
    }
  };

  if (!user) return null;

  const navItems = NAV.filter((item) => !item.roles || item.roles.includes(user.role));
  const activeNotificationCount = notifications.filter((item) => !item.acknowledged_at).length;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 pb-5 pt-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-white">
          <ShieldCheck size={17} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold tracking-tight">FDR Sentinel</p>
          <p className="truncate text-[11px] text-muted">Security deposit workspace</p>
        </div>
        <button
          type="button"
          className="ml-auto rounded p-1 text-muted hover:bg-canvas lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <nav aria-label="Primary" className="flex-1 space-y-0.5 px-2.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors",
                isActive
                  ? "bg-primary-soft text-primary"
                  : "text-muted hover:bg-canvas hover:text-ink",
              )
            }
          >
            <item.icon size={16} aria-hidden />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-4 space-y-3 border-t border-line px-4 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
            {user.institution ? "Your institution" : "Scope"}
          </p>
          <p className="mt-1 truncate text-[13px] font-medium">
            {user.institution?.name ?? "All institutions"}
          </p>
          <p className="truncate text-[11px] text-muted">{ROLE_LABELS[user.role]}</p>
        </div>
        <p className="text-[11px] leading-5 text-muted">
          Prototype with synthetic data.{" "}
          {meta?.verification.simulated
            ? "Bank verification is SIMULATED — not a confirmation."
            : "No bank verification integration."}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[70] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>

      <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:block lg:h-screen">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[272px] border-r border-line bg-surface shadow-xl">
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded p-1.5 text-muted hover:bg-canvas hover:text-ink lg:hidden"
              aria-label="Open navigation"
            >
              <Menu size={19} aria-hidden />
            </button>
            <Link to="/app/overview" className="flex items-center gap-2 lg:hidden">
              <ShieldCheck size={16} className="text-primary" aria-hidden />
              <span className="text-sm font-semibold">FDR Sentinel</span>
            </Link>

            <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
              <div className="relative">
                <button
                  type="button"
                  onClick={openBell}
                  className="relative rounded p-2 text-muted hover:bg-canvas hover:text-ink"
                  aria-label={`Notifications${unreadNotifications > 0 ? `, ${unreadNotifications} unread` : ""}`}
                  aria-expanded={bellOpen}
                >
                  <Bell size={18} aria-hidden />
                  {unreadNotifications > 0 && (
                    <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white tnum">
                      {unreadNotifications > 9 ? "9+" : unreadNotifications}
                    </span>
                  )}
                </button>
                {bellOpen && (
                  <div className="absolute right-0 top-11 z-40 w-[min(92vw,380px)] rounded-lg border border-line bg-surface shadow-xl">
                    <div className="flex items-center justify-between border-b border-line px-4 py-3">
                      <p className="text-sm font-semibold">Maturity alerts</p>
                      <Badge tone="neutral">{activeNotificationCount} unread</Badge>
                    </div>
                    <div className="max-h-[360px] overflow-y-auto">
                      {notificationsLoading ? (
                        <div className="p-4">
                          <LoadingRows rows={3} label="Loading alerts" />
                        </div>
                      ) : notifications.length === 0 ? (
                        <EmptyState
                          title="No alerts"
                          description="Maturity alerts appear here when a tracked FDR crosses a 30, 15 or 7 day threshold, or becomes overdue."
                        />
                      ) : (
                        <ul className="divide-y divide-line">
                          {notifications.map((item) => (
                            <li key={item.id} className="px-4 py-3">
                              <div className="flex items-start justify-between gap-2">
                                <Link
                                  to={`/app/fdrs/${item.fdr_id}`}
                                  className="text-[13px] font-medium text-primary hover:underline"
                                >
                                  {item.fdr_reference ?? "FDR record"}
                                </Link>
                                <span className="text-[11px] text-muted">
                                  {formatDateTime(item.created_at)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs leading-5 text-muted">{item.message}</p>
                              {item.acknowledged_at ? (
                                <p className="mt-1.5 text-[11px] text-muted">Acknowledged</p>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void acknowledge(item)}
                                  className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
                                >
                                  Acknowledge
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="border-t border-line px-4 py-2.5">
                      <Link
                        to="/app/maturity"
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Open maturity queue
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              <div className="hidden items-center gap-2 border-l border-line pl-3 sm:flex">
                <span
                  aria-hidden
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary"
                >
                  {initials(user.name)}
                </span>
                <div className="min-w-0">
                  <p className="max-w-[160px] truncate text-[13px] font-medium leading-tight">
                    {user.name}
                  </p>
                  <p className="max-w-[160px] truncate text-[11px] leading-tight text-muted">
                    {ROLE_LABELS[user.role]}
                  </p>
                </div>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => void signOut()}
                icon={<LogOut size={15} aria-hidden />}
                aria-label="Sign out"
              >
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>
        </header>

        <main id="main" className="flex-1">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
            <Outlet />
          </div>
          <footer className="mx-auto w-full max-w-[1440px] px-4 pb-8 pt-4 sm:px-6 lg:px-8">
            <p className="border-t border-line pt-4 text-[11px] leading-5 text-muted">
              FDR Sentinel prototype. Synthetic demonstration data only. The system does not prove
              FDR authenticity, does not contact a bank, and does not move funds.{" "}
              {meta?.verification.simulated && (
                <strong className="font-medium text-warning">
                  Simulated verification mode is enabled.
                </strong>
              )}
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
