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

/** Faixas de prioridade. Quatro, e não uma escala contínua. */
export type PriorityTier = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA';

/**
 * Fronteiras das faixas, da maior para a menor.
 *
 * **Por que faixas.** O score ordena a fila, mas ninguém pensa "1.340 é pior que
 * 1.320" — pensa "crítico contra alto". Comparar números é cognição serial: para
 * achar o pior de 100 itens seria preciso ler 100 números. Uma cor na borda da
 * linha é lida na periferia, antes de qualquer leitura.
 *
 * **Como as fronteiras foram escolhidas.** Não são redondas por estética: saíram
 * da distribuição real da base (120 incidentes, out/2026 — p10=740, p25=780,
 * p50=910, p75=1030, p90=1160, máx=1400). As primeiras que tentei (1000/700/400)
 * jogavam ~55% da fila numa faixa só, e faixa que concentra mais da metade não
 * ajuda a triar. Estas caem perto dos quartis e separam a fila em blocos de
 * tamanho comparável.
 *
 * São quatro números num lugar só: recalibrar é mudar aqui, e o teste de
 * fronteira diz exatamente o que muda.
 */
export const PRIORITY_TIER_THRESHOLDS: ReadonlyArray<{ tier: PriorityTier; min: number }> = [
  { tier: 'CRITICA', min: 1100 },
  { tier: 'ALTA', min: 900 },
  { tier: 'MEDIA', min: 700 },
  { tier: 'BAIXA', min: Number.NEGATIVE_INFINITY },
];

/** Faixa a que um score pertence. */
export function priorityTier(score: number): PriorityTier {
  const faixa = PRIORITY_TIER_THRESHOLDS.find((candidata) => score >= candidata.min);
  // Inalcançável com a última fronteira em `-Infinity`, mas devolver `BAIXA` é
  // melhor do que estourar por causa de um `NaN` que apareça na tela.
  return faixa?.tier ?? 'BAIXA';
}

export interface PriorityTierPresentation {
  /** Símbolo geométrico próprio: legível em escala de cinza. */
  icon: string;
  label: string;
  accentClass: string;
  softClass: string;
  textClass: string;
  /** Borda esquerda da linha: 4px (CRÍTICA), 3px (ALTA), 2px (MÉDIA), 1px (BAIXA). */
  borderClass: string;
  description: string;
}

/**
 * Três canais redundantes por faixa: cor + forma + rótulo.
 *
 * Cor sozinha falha para quem não a distingue (WCAG 1.4.1), então a forma
 * geométrica e o texto carregam a mesma informação.
 */
export const PRIORITY_TIER_PRESENTATION: Record<PriorityTier, PriorityTierPresentation> = {
  CRITICA: {
    icon: '▲',
    label: 'Crítica',
    accentClass: 'text-prio-critica',
    softClass: 'bg-prio-critica-soft',
    textClass: 'text-prio-critica-text',
    borderClass: 'border-l-4 border-l-prio-critica',
    description: 'Prioridade crítica — atender agora',
  },
  ALTA: {
    icon: '◆',
    label: 'Alta',
    accentClass: 'text-prio-alta',
    softClass: 'bg-prio-alta-soft',
    textClass: 'text-prio-alta-text',
    borderClass: 'border-l-[3px] border-l-prio-alta',
    description: 'Prioridade alta — atender em seguida',
  },
  MEDIA: {
    icon: '●',
    label: 'Média',
    accentClass: 'text-prio-media',
    softClass: 'bg-prio-media-soft',
    textClass: 'text-prio-media-text',
    borderClass: 'border-l-2 border-l-prio-media',
    description: 'Prioridade média — na fila',
  },
  BAIXA: {
    icon: '○',
    label: 'Baixa',
    accentClass: 'text-prio-baixa',
    softClass: 'bg-prio-baixa-soft',
    textClass: 'text-prio-baixa-text',
    borderClass: 'border-l border-l-prio-baixa',
    description: 'Prioridade baixa — sem urgência',
  },
};

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
