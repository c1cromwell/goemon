/** Minimal toast system — a single transient message at a time. */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type ToastKind = "info" | "bad";
interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: ToastKind = "info") => {
    setToast({ message, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {toast ? <div className={`toast ${toast.kind === "bad" ? "bad" : ""}`}>{toast.message}</div> : null}
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
