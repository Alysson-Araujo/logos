import { AlertTriangle, Copy, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/useToast';
import { isApiError } from '@/lib/http';
import { copyTextToClipboard } from '@/lib/utils';

export type ErrorStateVariant = 'recoverable' | 'fatal';

export interface ErrorStateProps {
  variant: ErrorStateVariant;
  error: unknown;
  onRetry?: () => void;
  isRetrying?: boolean;
  /** Tentativas já consumidas pelo retry automático (contagem visível). */
  failureCount?: number;
  /** `true` quando renderizado como faixa acima do cache antigo. */
  compact?: boolean;
}

function describeError(error: unknown): string {
  if (isApiError(error)) return error.message;
  return error instanceof Error ? error.message : 'Erro inesperado.';
}

/**
 * `errorRecoverable`: 5xx/timeout → card com "Tentar novamente" e contagem,
 * mantendo o cache antigo visível na tela.
 * `errorFatal`: 4xx/contrato → mensagem clara + "Copiar detalhes técnicos".
 */
export function ErrorState({
  variant,
  error,
  onRetry,
  isRetrying = false,
  failureCount = 0,
  compact = false,
}: ErrorStateProps) {
  const pushToast = useToast();
  const [isCopying, setIsCopying] = useState(false);
  const message = describeError(error);

  const handleCopy = (): void => {
    const payload = isApiError(error)
      ? error.toTechnicalDetails()
      : JSON.stringify({ message }, null, 2);
    setIsCopying(true);
    void copyTextToClipboard(payload).then((copied) => {
      setIsCopying(false);
      pushToast({
        variant: copied ? 'info' : 'error',
        title: copied ? 'Detalhes técnicos copiados' : 'Não foi possível copiar',
        description: copied ? null : 'Copie manualmente pelo console do navegador.',
      });
    });
  };

  const Icon = variant === 'fatal' ? ShieldAlert : AlertTriangle;

  return (
    <div
      data-testid={`error-state-${variant}`}
      role="alert"
      className={
        compact
          ? 'flex flex-wrap items-center gap-3 rounded-md border border-danger bg-danger-soft px-3 py-2'
          : 'flex flex-col items-center gap-3 rounded-md border border-danger bg-danger-soft px-6 py-8 text-center'
      }
    >
      <Icon
        className={compact ? 'h-4 w-4 text-danger-text' : 'h-7 w-7 text-danger-text'}
        aria-hidden="true"
      />
      <div className={compact ? 'flex-1' : 'space-y-1'}>
        <p className="text-sm font-semibold text-danger-text">
          {variant === 'fatal'
            ? 'A API respondeu algo fora do contrato'
            : 'Não foi possível carregar os incidentes'}
        </p>
        <p className="text-xs text-danger-text">{message}</p>
        {variant === 'recoverable' && failureCount > 0 ? (
          <p className="text-2xs text-danger-text">
            Tentativa automática {failureCount} de 3 concluída — próximo retry com backoff e jitter.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {variant === 'recoverable' && onRetry !== undefined ? (
          <Button variant="secondary" size="sm" onClick={onRetry} disabled={isRetrying}>
            <RefreshCw
              className={isRetrying ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'}
              aria-hidden="true"
            />
            {isRetrying ? 'Tentando novamente…' : 'Tentar novamente'}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={handleCopy} disabled={isCopying}>
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copiar detalhes técnicos
        </Button>
      </div>
    </div>
  );
}
