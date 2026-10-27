import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { EmptyState, LinkButton } from "./components/ui";
import { useAuth } from "./lib/auth";
import type { Role } from "./lib/types";
import AdminUsersPage from "./pages/AdminUsersPage";
import AuditPage from "./pages/AuditPage";
import FdrDetailPage from "./pages/FdrDetailPage";
import FdrListPage from "./pages/FdrListPage";
import LoginPage from "./pages/LoginPage";
import MaturityPage from "./pages/MaturityPage";
import NewFdrPage from "./pages/NewFdrPage";
import NotFoundPage from "./pages/NotFoundPage";
import OverviewPage from "./pages/OverviewPage";
import ReleaseRequestsPage from "./pages/ReleaseRequestsPage";
import ReportsPage from "./pages/ReportsPage";
import ReviewQueuePage from "./pages/ReviewQueuePage";

function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas" role="status">
      <Loader2 className="animate-spin text-primary" size={22} aria-hidden />
      <span className="sr-only">Loading</span>
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleGate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) {
    return (
      <div className="panel hairline">
        <EmptyState
          title="You don't have permission to view this page"
          description="This workspace is restricted to a different role. If you need access, contact a system administrator."
          action={<LinkButton to="/app/overview">Back to overview</LinkButton>}
        />
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/app/overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="fdrs" element={<FdrListPage />} />
        <Route path="fdrs/new" element={<NewFdrPage />} />
        <Route path="fdrs/:fdrId" element={<FdrDetailPage />} />
        <Route path="review-queue" element={<ReviewQueuePage />} />
        <Route path="maturity" element={<MaturityPage />} />
        <Route path="release-requests" element={<ReleaseRequestsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route
          path="admin/users"
          element={
            <RoleGate roles={["SYSTEM_ADMIN"]}>
              <AdminUsersPage />
            </RoleGate>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/app/overview" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
