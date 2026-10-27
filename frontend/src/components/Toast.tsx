import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId++;
      setItems((current) => [...current.slice(-3), { id, tone, message }]);
      window.setTimeout(() => remove(id), tone === "error" ? 8000 : 4500);
    },
    [remove],
  );

  const value = useMemo<ToastValue>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  );

  const styles: Record<ToastTone, string> = {
    success: "border-success/30 bg-surface text-ink",
    error: "border-danger/30 bg-surface text-ink",
    info: "border-info/30 bg-surface text-ink",
  };

  const icons: Record<ToastTone, ReactNode> = {
    success: <CheckCircle2 size={18} className="text-success" aria-hidden />,
    error: <AlertTriangle size={18} className="text-danger" aria-hidden />,
    info: <Info size={18} className="text-info" aria-hidden />,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="fixed inset-x-3 bottom-3 z-[60] flex flex-col gap-2 sm:left-auto sm:right-5 sm:bottom-5 sm:w-[380px]"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${styles[item.tone]}`}
          >
            <span className="mt-0.5 shrink-0">{icons[item.tone]}</span>
            <p className="flex-1 leading-snug">{item.message}</p>
            <button
              type="button"
              onClick={() => remove(item.id)}
              aria-label="Dismiss notification"
              className="rounded p-1 text-muted hover:bg-canvas hover:text-ink"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
