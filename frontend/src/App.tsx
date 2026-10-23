import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Spinner } from "./components/ui/Spinner";
import { useAuth } from "./hooks/useAuth";
import { ComposePage } from "./pages/ComposePage";
import { DashboardPage } from "./pages/DashboardPage";
import { EmailPage } from "./pages/EmailPage";
import { LoginPage } from "./pages/LoginPage";

function FullPageSpinner() {
  return (
    <div className="flex h-full items-center justify-center text-brand-600 dark:text-brand-400">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  return user ? <Navigate to="/" replace /> : <>{children}</>;
}

const guarded = (page: ReactNode) => <RequireAuth>{page}</RequireAuth>;

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/" element={guarded(<DashboardPage />)} />
      <Route path="/compose" element={guarded(<ComposePage />)} />
      <Route path="/email/:id" element={guarded(<EmailPage />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
