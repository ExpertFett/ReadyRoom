import { createContext, useCallback, useContext, useState } from 'react';

// Lightweight toast system. useToast() returns { toast, success, error }.
// Toasts auto-dismiss; click to dismiss early. Replaces alert() for
// non-blocking feedback (destructive confirms still use confirm()).
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

let seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const push = useCallback((message, kind = 'info', ms = 3800) => {
    const id = ++seq;
    setToasts((ts) => [...ts, { id, message, kind }]);
    if (ms) setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);

  const value = useCallback(Object.assign(
    (message, kind, ms) => push(message, kind, ms),
    {
      success: (m, ms) => push(m, 'success', ms),
      error: (m, ms) => push(m, 'error', ms ?? 5200),
      info: (m, ms) => push(m, 'info', ms),
    },
  ), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)} role="status">
            <span className="toast-dot" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
