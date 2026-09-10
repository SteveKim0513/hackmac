import { useEffect, useState } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'ok' | 'error';
}

let nextId = 1;
export function makeToast(text: string, tone: ToastMessage['tone'] = 'ok'): ToastMessage {
  return { id: nextId++, text, tone };
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 3200);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return <div className={`toast toast-${toast.tone}`}>{toast.text}</div>;
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const push = (text: string, tone: ToastMessage['tone'] = 'ok') => setToasts((prev) => [...prev, makeToast(text, tone)]);
  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));
  return { toasts, push, dismiss };
}
