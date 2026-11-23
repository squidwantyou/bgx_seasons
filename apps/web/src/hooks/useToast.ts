import { useCallback, useEffect, useRef, useState } from 'react';

export interface ToastState {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string, tone: ToastState['tone'] = 'info') => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, tone });
    timer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { toast, show, dismiss: () => setToast(null) };
}
