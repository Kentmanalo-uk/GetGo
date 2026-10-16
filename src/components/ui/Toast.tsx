import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { cx } from './cx';

interface ToastItem {
  id: number;
  message: string;
  tone: 'default' | 'error';
}

const ToastContext = createContext<{ show: (message: string, tone?: ToastItem['tone']) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((message: string, tone: ToastItem['tone'] = 'default') => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex max-w-md items-center gap-2.5 rounded-control px-4 py-3 text-small font-medium shadow-pop',
              t.tone === 'error' ? 'bg-danger text-white' : 'bg-ink text-white',
            )}
          >
            {t.tone === 'error' ? <X className="size-4 shrink-0" aria-hidden /> : <Check className="size-4 shrink-0 text-accent" aria-hidden />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx.show;
}
