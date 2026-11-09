import { Icon } from './icons.js';

export type ToastTone = 'info' | 'success' | 'error';

export type ToastItem = {
  id: string;
  tone: ToastTone;
  message: string;
};

export function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <Icon
            name={
              toast.tone === 'error' ? 'warning' : toast.tone === 'success' ? 'check' : 'sparkles'
            }
            size={17}
          />
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(toast.id)}
            aria-label="إغلاق التنبيه"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
