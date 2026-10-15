import { CATEGORY_LABELS, CRITICALITY_LABELS } from './labels';
import type { Incident, IncidentCategory, IncidentCriticality } from './types';

/**
 * Priority score (seção 9.2). A ordem oficial vem do servidor; aqui vive apenas
 * a explicação — o mesmo cálculo, para o tooltip e para as fábricas de mock.
 */
export const CATEGORY_IMPACT: Record<IncidentCategory, number> = {
  ACIDENTE_COM_VITIMAS: 300,
  BLOQUEIO_DE_PISTA: 180,
  ACIDENTE_COM_VEICULO: 150,
  CONDICAO_CLIMATICA_ATIPICA: 100,
  PROBLEMA_MECANICO: 60,
};

export const CRITICALITY_URGENCY: Record<IncidentCriticality, number> = {
  ALTA: 500,
  MEDIA: 250,
  BAIXA: 80,
};

export const AGING_PER_HOUR = 12;
export const AGING_CAP = 400;
export const SLA_PRESSURE_SCORE = 200;
export const SLA_PRESSURE_WINDOW_MINUTES = 60;

export interface PriorityExplanation {
  impact: number;
  urgency: number;
  aging: number;
  slaPressure: number;
  total: number;
  /** "Prioridade 1.340 — Acidente com Vítimas + Alta + 4h em aberto" */
  summary: string;
  reasons: string[];
}

type PriorityInput = Pick<Incident, 'category' | 'criticality' | 'createdAt' | 'slaDueAt'>;

function agingHours(createdAt: string): number {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, (Date.now() - created) / 3_600_000);
}

function slaMinutesLeft(slaDueAt: string): number | null {
  const due = Date.parse(slaDueAt);
  if (Number.isNaN(due)) return null;
  return (due - Date.now()) / 60_000;
}

export function computePriorityScore(incident: PriorityInput): number {
  return explainPriority(incident).total;
}

export function explainPriority(incident: PriorityInput): PriorityExplanation {
  const impact = CATEGORY_IMPACT[incident.category];
  const urgency = CRITICALITY_URGENCY[incident.criticality];
  const hours = agingHours(incident.createdAt);
  const aging = Math.min(Math.round(hours * AGING_PER_HOUR), AGING_CAP);
  const minutesLeft = slaMinutesLeft(incident.slaDueAt);
  const slaPressure =
    minutesLeft !== null && minutesLeft < SLA_PRESSURE_WINDOW_MINUTES ? SLA_PRESSURE_SCORE : 0;
  const total = impact + urgency + aging + slaPressure;

  const hoursRounded = Math.max(1, Math.round(hours));
  const reasons = [
    `Impacto da categoria (${CATEGORY_LABELS[incident.category]}): ${String(impact)}`,
    `Urgência (${CRITICALITY_LABELS[incident.criticality]}): ${String(urgency)}`,
    `Aging (${String(hoursRounded)}h em aberto): ${String(aging)}`,
  ];
  if (slaPressure > 0) {
    reasons.push(`Pressão de SLA (vence em menos de 1h): ${String(slaPressure)}`);
  }

  const summary =
    `Prioridade ${String(total)} — ${CATEGORY_LABELS[incident.category]} + ` +
    `${CRITICALITY_LABELS[incident.criticality]} + ${String(hoursRounded)}h em aberto`;

  return { impact, urgency, aging, slaPressure, total, summary, reasons };
}
