import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react';

import { useToastStore, type ToastVariant } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

const VARIANT_META: Record<ToastVariant, { icon: LucideIcon; iconClass: string }> = {
  success: { icon: CheckCircle2, iconClass: 'text-success' },
  error: { icon: XCircle, iconClass: 'text-danger' },
  info: { icon: Info, iconClass: 'text-info' },
};

/**
 * Região viva `polite` para os avisos (seção 9.6).
 * Os toasts entram em modo `background` no Radix justamente para que a
 * anúncia seja feita por esta região única, sem interromper o analista.
 */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div role="status" aria-live="polite" aria-atomic="false" className="contents">
      <ToastPrimitive.Provider swipeDirection="right" duration={2500}>
        {toasts.map((toast) => {
          const meta = VARIANT_META[toast.variant];
          const Icon = meta.icon;
          return (
            <ToastPrimitive.Root
              key={toast.id}
              type="background"
              open
              duration={toast.durationMs}
              onOpenChange={(open) => {
                if (!open) dismiss(toast.id);
              }}
              className={cn(
                'flex items-start gap-3 rounded-md border border-border bg-surface-raised p-3 shadow-e2',
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2',
                'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-2',
              )}
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', meta.iconClass)} aria-hidden="true" />
              <div className="flex-1">
                <ToastPrimitive.Title className="text-sm font-semibold text-fg">
                  {toast.title}
                </ToastPrimitive.Title>
                {toast.description === null ? null : (
                  <ToastPrimitive.Description className="mt-0.5 text-xs text-fg-muted">
                    {toast.description}
                  </ToastPrimitive.Description>
                )}
              </div>
              <ToastPrimitive.Close
                aria-label="Fechar aviso"
                className="rounded-sm p-0.5 text-fg-subtle transition-colors duration-hover hover:text-fg"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[80] flex w-[min(92vw,22rem)] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </div>
  );
}
