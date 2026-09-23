import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const ToastContext = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (type, message, ttl = 5000) => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-3), { id, type, message }]);
      if (ttl) setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', typeof m === 'string' ? m : m?.message || 'Something went wrong', 7000),
      info: (m) => push('info', m),
    }),
    [push],
  );

  const Icon = { success: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => {
          const I = Icon[t.type];
          return (
            <div key={t.id} className={`toast ${t.type}`}>
              <I size={18} aria-hidden />
              <span>{t.message}</span>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
