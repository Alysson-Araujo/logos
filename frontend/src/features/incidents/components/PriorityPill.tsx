import { cn } from '@/lib/utils';

import { explainPriority, PRIORITY_TIER_PRESENTATION, priorityTier } from '../priority';
import type { Incident } from '../types';

export interface PriorityPillProps {
  incident: Pick<Incident, 'category' | 'criticality' | 'createdAt' | 'slaDueAt'> & {
    priorityScore: number;
  };
}

/**
 * Faixa de prioridade, com o score ao lado.
 *
 * **A faixa vem primeiro, o número depois.** Comparar 1.340 com 1.320 é cognição
 * serial — para achar o pior de 100 itens seria preciso ler 100 números. A faixa
 * é lida de relance: forma, cor e rótulo dizem o mesmo, em três canais, e o
 * número fica como desempate fino para quem já parou na linha.
 *
 * O `data-tier` existe para o teste afirmar a faixa sem depender de classe de
 * cor — que é justamente o que se quer poder mudar sem quebrar teste.
 */
export function PriorityPill({ incident }: PriorityPillProps) {
  const tier = priorityTier(incident.priorityScore);
  const presentation = PRIORITY_TIER_PRESENTATION[tier];

  return (
    <span
      data-testid="priority-pill"
      data-tier={tier}
      title={presentation.description}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold',
        presentation.softClass,
        presentation.textClass,
      )}
    >
      <span aria-hidden="true">{presentation.icon}</span>
      {presentation.label}
      <span className="font-mono nums font-normal opacity-70">{incident.priorityScore}</span>
    </span>
  );
}

/** Texto usado no tooltip e no drawer (explicabilidade gera confiança — 9.2). */
export function describePriority(incident: PriorityPillProps['incident']): string {
  return explainPriority(incident).summary;
}
