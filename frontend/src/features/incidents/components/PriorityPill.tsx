import { explainPriority } from '../priority';
import type { Incident } from '../types';

export interface PriorityPillProps {
  incident: Pick<Incident, 'category' | 'criticality' | 'createdAt' | 'slaDueAt'> & {
    priorityScore: number;
  };
}

/**
 * Score de prioridade com explicação acessível via tooltip no gatilho que
 * envolve a linha (ver `IncidentRow`). Aqui fica só a leitura numérica.
 */
export function PriorityPill({ incident }: PriorityPillProps) {
  return (
    <span
      data-testid="priority-pill"
      className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 font-mono text-2xs nums text-fg-muted"
    >
      score
      <strong className="font-semibold text-fg">{incident.priorityScore}</strong>
    </span>
  );
}

/** Texto usado no tooltip e no drawer (explicabilidade gera confiança — 9.2). */
export function describePriority(incident: PriorityPillProps['incident']): string {
  return explainPriority(incident).summary;
}
