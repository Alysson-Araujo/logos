import * as ToastPrimitive from '@radix-ui/react-toast';
import { CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';

import { useToastStore, type ToastItem, type ToastVariant } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

const VARIANT_META: Record<ToastVariant, { icon: LucideIcon; iconClass: string }> = {
  success: { icon: CheckCircle2, iconClass: 'text-success' },
  error: { icon: XCircle, iconClass: 'text-danger' },
  info: { icon: Info, iconClass: 'text-info' },
};

/** Duração da animação de saída; depois dela o item pode sair do estado. */
const EXIT_MS = 180;

/** Quem pediu menos movimento no sistema recebe a troca sem animação. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Um aviso.
 *
 * A saída é controlada: `open` vira `false` quando o item entra em `closing`,
 * o Radix roda a animação de saída e **só então** o item é removido do estado.
 * Esse é o conserto do "aparece e some seco" — antes o item era removido no
 * mesmo instante do vencimento, e a animação não tinha tempo de rodar.
 */
function ToastRow({ toast }: { toast: ToastItem }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const remove = useToastStore((state) => state.remove);
  const meta = VARIANT_META[toast.variant];
  const Icon = meta.icon;

  useEffect(() => {
    if (!toast.closing) return;
    if (prefersReducedMotion()) {
      remove(toast.id);
      return;
    }
    const timer = window.setTimeout(() => {
      remove(toast.id);
    }, EXIT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast.closing, toast.id, remove]);

  return (
    <ToastPrimitive.Root
      open={!toast.closing}
      type="background"
      duration={toast.durationMs}
      onOpenChange={(open) => {
        if (!open) dismiss(toast.id);
      }}
      className={cn(
        'flex items-start gap-3 rounded-md border border-border bg-surface-raised p-3 shadow-e2',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-2',
        'motion-safe:duration-200',
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
}

/**
 * Região viva `polite` para os avisos (seção 9.6).
 * Os toasts entram em modo `background` no Radix justamente para que a
 * anúncia seja feita por esta região única, sem interromper o analista.
 */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <div role="status" aria-live="polite" aria-atomic="false" className="contents">
      <ToastPrimitive.Provider swipeDirection="right" duration={2500}>
        {toasts.map((toast) => (
          <ToastRow key={toast.id} toast={toast} />
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[80] flex w-[min(92vw,22rem)] flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </div>
  );
}
