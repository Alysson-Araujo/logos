import { formatCount } from '@/lib/formatters';
import { cn } from '@/lib/utils';

import type { IncidentCounters } from '../hooks/useIncidents';
import { INCIDENT_STATUSES, type IncidentStatus } from '../types';
import { STATUS_PRESENTATION } from './StatusBadge';

const STATUS_HINTS: Record<IncidentStatus, string> = {
  ABERTO: 'aguardando triagem',
  EM_INVESTIGACAO: 'em andamento',
  FECHADO: 'histórico',
  INCONCLUSIVO: 'sem laudo',
};

export interface KpiCardsProps {
  counters: IncidentCounters;
  activeStatuses: readonly IncidentStatus[];
  onToggleStatus: (status: IncidentStatus) => void;
  isLoading: boolean;
}

/** KPIs do topo: contagem por status e atalho para filtrar (clicável). */
export function KpiCards({ counters, activeStatuses, onToggleStatus, isLoading }: KpiCardsProps) {
  return (
    <section aria-label="Resumo por status" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {INCIDENT_STATUSES.map((status) => {
        const presentation = STATUS_PRESENTATION[status];
        const isActive = activeStatuses.includes(status);
        return (
          <button
            key={status}
            type="button"
            onClick={() => {
              onToggleStatus(status);
            }}
            aria-pressed={isActive}
            className={cn(
              'flex flex-col items-start gap-1 rounded-md border bg-surface px-3 py-2.5 text-left shadow-e1',
              'transition-colors duration-hover ease-panel hover:bg-surface-sunken',
              isActive ? 'border-accent ring-1 ring-accent' : 'border-border',
            )}
          >
            <span className="flex w-full items-center gap-2">
              <span aria-hidden="true" className={cn('text-xs', presentation.dotClass)}>
                {presentation.shape}
              </span>
              <span className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">
                {presentation.label}
              </span>
            </span>
            {isLoading ? (
              <span
                aria-hidden="true"
                className="h-7 w-14 animate-pulse rounded-sm bg-surface-sunken"
              />
            ) : (
              <span aria-live="polite" className="font-mono text-xl font-semibold nums text-fg">
                {formatCount(counters.byStatus[status])}
              </span>
            )}
            <span className="text-2xs text-fg-subtle">{STATUS_HINTS[status]}</span>
          </button>
        );
      })}
    </section>
  );
}
