import { AlertCircle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const kinds: Record<ToastKind, { icon: LucideIcon; className: string }> = {
  success: { icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  error: { icon: AlertCircle, className: "text-red-600 dark:text-red-400" },
  info: { icon: Info, className: "text-sky-600 dark:text-sky-400" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (kind: ToastKind, title: string, description?: string) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, kind, title, description }]);
      setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, d) => push("success", t, d),
      error: (t, d) => push("error", t, d),
      info: (t, d) => push("info", t, d),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const { icon: Icon, className } = kinds[t.kind];
          return (
            <div key={t.id} className="animate-slide-up pointer-events-auto flex gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-pop">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.title}</p>
                {t.description && <p className="mt-0.5 text-[13px] text-fg-muted">{t.description}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-fg-subtle hover:text-fg" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
