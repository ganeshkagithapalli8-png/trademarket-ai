import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

const ICONS = {
  success: 'M20 6L9 17l-5-5',
  error: 'M18 6L6 18M6 6l12 12',
  info: 'M12 16v-4M12 8h.01',
  warn: 'M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
};

const STYLES = {
  success: 'border-emerald-200 bg-emerald-50/95 text-emerald-900',
  error: 'border-rose-200 bg-rose-50/95 text-rose-900',
  info: 'border-brand-200 bg-brand-50/95 text-brand-900',
  warn: 'border-amber-200 bg-amber-50/95 text-amber-900',
};

const ICON_BG = {
  success: 'bg-emerald-500',
  error: 'bg-rose-500',
  info: 'bg-brand-500',
  warn: 'bg-amber-500',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (type, title, message, ms = 4200) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((t) => [...t.slice(-3), { id, type, title, message }]);
      if (ms) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      push,
      dismiss,
      success: (t, m) => push('success', t, m),
      error: (t, m) => push('error', t, m, 6000),
      info: (t, m) => push('info', t, m),
      warn: (t, m) => push('warn', t, m, 6000),
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-3 pt-3 sm:items-end sm:px-5 sm:pt-5"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-2xl border px-3.5 py-3 shadow-lift backdrop-blur-xl ${STYLES[t.type] || STYLES.info}`}
          >
            <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-white ${ICON_BG[t.type] || ICON_BG.info}`}>
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d={ICONS[t.type] || ICONS.info} />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-bold leading-tight">{t.title}</p>
              {t.message && <p className="mt-0.5 text-[12.5px] leading-snug opacity-85 break-words">{t.message}</p>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-50 transition hover:opacity-100"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
