import { WifiOff } from 'lucide-react';

export interface OfflineBannerProps {
  isOnline: boolean;
  /** Mutações paradas esperando conexão. Ver `useFilaDeMutacoes`. */
  pendingCount?: number;
}

/**
 * Estado `offline`: banner fixo enquanto `navigator.onLine === false`.
 *
 * O texto muda quando há alterações na fila. "Suas alterações serão enviadas ao
 * reconectar" é uma promessa; "2 alterações aguardando conexão" é um **estado**.
 * A diferença é o que impede a analista de repetir uma transição por não saber
 * se a primeira entrou — repetir uma decisão é como se duplica um registro.
 */
export function OfflineBanner({ isOnline, pendingCount = 0 }: OfflineBannerProps) {
  if (isOnline) return null;

  const temFila = pendingCount > 0;

  return (
    <div
      data-testid="offline-banner"
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-warning bg-warning-soft px-4 py-2 text-xs font-medium text-warning-text"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      {temFila ? (
        <span>
          Sem conexão —{' '}
          <strong className="font-semibold">
            {pendingCount === 1
              ? '1 alteração aguardando conexão'
              : `${String(pendingCount)} alterações aguardando conexão`}
          </strong>
          . Elas serão enviadas automaticamente ao reconectar.
        </span>
      ) : (
        <span>
          Sem conexão — exibindo últimos dados. Suas alterações serão enviadas ao reconectar.
        </span>
      )}
    </div>
  );
}
