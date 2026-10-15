import { cn } from '@/lib/utils';

import { CRITICALITY_LABELS } from '../labels';
import type { IncidentCriticality } from '../types';

export interface CriticalityPresentation {
  /** Símbolo geométrico próprio: legível em escala de cinza (não depende de cor). */
  icon: string;
  label: string;
  accentClass: string;
  softClass: string;
  textClass: string;
  /** Borda esquerda da linha: 4px (ALTA), 3px (MÉDIA), 2px (BAIXA). */
  borderClass: string;
  description: string;
}

/** Três canais redundantes por criticidade: cor + forma + rótulo textual. */
export const CRITICALITY_PRESENTATION: Record<IncidentCriticality, CriticalityPresentation> = {
  ALTA: {
    icon: '▲',
    label: CRITICALITY_LABELS.ALTA,
    accentClass: 'text-crit-alta',
    softClass: 'bg-crit-alta-soft',
    textClass: 'text-crit-alta-text',
    borderClass: 'border-l-4 border-l-crit-alta',
    description: 'Criticidade alta — atendimento imediato',
  },
  MEDIA: {
    icon: '◆',
    label: CRITICALITY_LABELS.MEDIA,
    accentClass: 'text-crit-media',
    softClass: 'bg-crit-media-soft',
    textClass: 'text-crit-media-text',
    borderClass: 'border-l-[3px] border-l-crit-media',
    description: 'Criticidade média — atender em seguida',
  },
  BAIXA: {
    icon: '●',
    label: CRITICALITY_LABELS.BAIXA,
    accentClass: 'text-crit-baixa',
    softClass: 'bg-crit-baixa-soft',
    textClass: 'text-crit-baixa-text',
    borderClass: 'border-l-2 border-l-crit-baixa',
    description: 'Criticidade baixa — fila normal',
  },
};

export interface CriticalityBadgeProps {
  criticality: IncidentCriticality;
  size?: 'sm' | 'md';
  className?: string;
}

export function CriticalityBadge({ criticality, size = 'md', className }: CriticalityBadgeProps) {
  const presentation = CRITICALITY_PRESENTATION[criticality];

  return (
    <span
      data-testid="criticality-badge"
      data-criticality={criticality}
      title={presentation.description}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-wide',
        presentation.softClass,
        presentation.textClass,
        size === 'sm' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('text-[0.8em] leading-none', presentation.accentClass)}
      >
        {presentation.icon}
      </span>
      {presentation.label}
    </span>
  );
}
