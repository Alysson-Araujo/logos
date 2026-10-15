import { Clock } from 'lucide-react';
import { memo } from 'react';

import { Tooltip } from '@/components/ui/tooltip';
import type { Density } from '@/hooks/useUiStore';
import { formatPlate, formatRelativeCompact } from '@/lib/formatters';
import { cn } from '@/lib/utils';

import { CATEGORY_LABELS } from '../labels';
import type { Incident } from '../types';
import { CRITICALITY_PRESENTATION, CriticalityBadge } from './CriticalityBadge';
import { PriorityPill, describePriority } from './PriorityPill';
import { SlaTimer } from './SlaTimer';
import { StatusBadge } from './StatusBadge';

export interface IncidentRowProps {
  incident: Incident;
  density: Density;
  isFocused: boolean;
  isSelected: boolean;
  /** Estado `pendingMutation`: linha com barra de progresso e opacidade reduzida. */
  isPending: boolean;
  /** Estado `success`: linha pisca suavemente depois do 200. */
  isRecentlyUpdated: boolean;
  onOpen: (id: string) => void;
  onFocus: (id: string) => void;
}

function IncidentRowComponent({
  incident,
  density,
  isFocused,
  isSelected,
  isPending,
  isRecentlyUpdated,
  onOpen,
  onFocus,
}: IncidentRowProps) {
  const presentation = CRITICALITY_PRESENTATION[incident.criticality];

  return (
    <Tooltip label={describePriority(incident)} side="bottom">
      <button
        type="button"
        data-testid="incident-row"
        data-incident-id={incident.id}
        data-criticality={incident.criticality}
        data-status={incident.status}
        data-focused={isFocused ? 'true' : undefined}
        aria-current={isSelected ? 'true' : undefined}
        onClick={() => {
          onOpen(incident.id);
        }}
        onMouseEnter={() => {
          onFocus(incident.id);
        }}
        onFocus={() => {
          onFocus(incident.id);
        }}
        className={cn(
          'relative flex w-full flex-col gap-1 border-b border-b-border bg-surface px-3 text-left',
          'transition-colors duration-hover ease-panel hover:bg-surface-sunken',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
          presentation.borderClass,
          density === 'compact' ? 'py-1.5' : 'py-2.5',
          isPending ? 'opacity-70' : null,
          isFocused ? 'bg-surface-sunken' : null,
          isRecentlyUpdated ? 'animate-row-flash' : null,
        )}
      >
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-2xs nums text-fg-muted">{incident.code}</span>
          <span className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
            {CATEGORY_LABELS[incident.category]}
          </span>
          <StatusBadge status={incident.status} size="sm" />
          {isPending ? (
            <span className="inline-flex items-center gap-1 text-2xs text-info-text">
              <Clock className="h-3 w-3" aria-hidden="true" />
              enviando…
            </span>
          ) : null}
          <span className="ml-auto">
            <SlaTimer slaDueAt={incident.slaDueAt} status={incident.status} />
          </span>
        </span>

        <span className="line-clamp-1 text-sm font-medium text-fg">{incident.title}</span>

        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-subtle">
          <span className="truncate">{incident.locationLabel ?? 'Local não informado'}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono nums">placa {formatPlate(incident.truckPlate)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatRelativeCompact(incident.createdAt)}</span>
          <span className="ml-auto flex items-center gap-2">
            <CriticalityBadge criticality={incident.criticality} size="sm" />
            <PriorityPill incident={incident} />
          </span>
        </span>

        {isPending ? (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-surface-sunken"
          >
            <span className="logos-indeterminate absolute inset-y-0 left-0 w-1/3 bg-accent" />
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}

/**
 * Comparação por `version`: só a linha alterada re-renderiza (seção 8.4).
 * `React.memo` com comparador próprio evita re-render por mudança de identidade.
 */
export const IncidentRow = memo(
  IncidentRowComponent,
  (previous, next) =>
    previous.incident.id === next.incident.id &&
    previous.incident.version === next.incident.version &&
    previous.incident.status === next.incident.status &&
    previous.incident.priorityScore === next.incident.priorityScore &&
    previous.density === next.density &&
    previous.isFocused === next.isFocused &&
    previous.isSelected === next.isSelected &&
    previous.isPending === next.isPending &&
    previous.isRecentlyUpdated === next.isRecentlyUpdated,
);
