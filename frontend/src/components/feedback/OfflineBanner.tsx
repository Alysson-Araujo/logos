import { WifiOff } from 'lucide-react';

export interface OfflineBannerProps {
  isOnline: boolean;
}

/** Estado `offline`: banner fixo enquanto `navigator.onLine === false`. */
export function OfflineBanner({ isOnline }: OfflineBannerProps) {
  if (isOnline) return null;

  return (
    <div
      data-testid="offline-banner"
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 border-b border-warning bg-warning-soft px-4 py-2 text-xs font-medium text-warning-text"
    >
      <WifiOff className="h-4 w-4" aria-hidden="true" />
      Sem conexão — exibindo últimos dados. Suas alterações serão enviadas ao reconectar.
    </div>
  );
}
