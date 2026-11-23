import type { ToastState } from '../hooks/useToast';

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
      {toast.text}
    </div>
  );
}
