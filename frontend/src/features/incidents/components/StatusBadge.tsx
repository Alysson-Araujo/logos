import { cn } from '@/lib/utils';

import { STATUS_LABELS } from '../labels';
import type { IncidentStatus } from '../types';

export interface StatusPresentation {
  label: string;
  /** Forma própria do status (redundância além da cor). */
  shape: string;
  dotClass: string;
  softClass: string;
  textClass: string;
}

export const STATUS_PRESENTATION: Record<IncidentStatus, StatusPresentation> = {
  ABERTO: {
    label: STATUS_LABELS.ABERTO,
    shape: '●',
    dotClass: 'text-status-aberto',
    softClass: 'bg-status-aberto-soft',
    textClass: 'text-status-aberto-text',
  },
  EM_INVESTIGACAO: {
    label: STATUS_LABELS.EM_INVESTIGACAO,
    shape: '◐',
    dotClass: 'text-status-investigacao',
    softClass: 'bg-status-investigacao-soft',
    textClass: 'text-status-investigacao-text',
  },
  FECHADO: {
    label: STATUS_LABELS.FECHADO,
    shape: '■',
    dotClass: 'text-status-fechado',
    softClass: 'bg-status-fechado-soft',
    textClass: 'text-status-fechado-text',
  },
  INCONCLUSIVO: {
    label: STATUS_LABELS.INCONCLUSIVO,
    shape: '◇',
    dotClass: 'text-status-inconclusivo',
    softClass: 'bg-status-inconclusivo-soft',
    textClass: 'text-status-inconclusivo-text',
  },
};

export interface StatusBadgeProps {
  status: IncidentStatus;
  size?: 'sm' | 'md';
  className?: string;
}

/** Pill de status: fundo suave + texto forte + forma + rótulo textual. */
export function StatusBadge({ status, size = 'md', className }: StatusBadgeProps) {
  const presentation = STATUS_PRESENTATION[status];

  return (
    <span
      data-testid="status-badge"
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold',
        presentation.softClass,
        presentation.textClass,
        size === 'sm' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs',
        className,
      )}
    >
      <span aria-hidden="true" className={cn('text-[0.9em] leading-none', presentation.dotClass)}>
        {presentation.shape}
      </span>
      {presentation.label}
    </span>
  );
}
