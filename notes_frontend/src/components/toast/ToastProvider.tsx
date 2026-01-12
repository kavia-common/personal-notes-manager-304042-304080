"use client";

import React, { createContext, useCallback, useMemo, useState } from "react";

type ToastType = "info" | "success" | "error";

type ToastItem = {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
};

type ToastContextValue = {
  push: (t: Omit<ToastItem, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function createToastId() {
  return `toast_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

/**
 * PUBLIC_INTERFACE
 * ToastProvider provides a lightweight toast system for the app.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = createToastId();
    const toast: ToastItem = { id, ...t };
    setToasts((prev) => [toast, ...prev].slice(0, 4));

    // Auto-dismiss
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 3200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${
              t.type === "error"
                ? "toast-error"
                : t.type === "success"
                  ? "toast-success"
                  : "toast-info"
            }`}
            role="status"
          >
            <div className="toast-title">{t.title}</div>
            {t.message ? <div className="toast-body">{t.message}</div> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * PUBLIC_INTERFACE
 * Hook to access toast actions.
 */
export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider.");
  }
  return ctx;
}
