/**
 * Passos do guia de boas-vindas (issue #131).
 *
 * O tour não conhece componentes: ele procura os alvos no DOM pelo atributo
 * `data-tour`. Quem marca as áreas reais da triagem é `KpiCards`, `FiltersBar`
 * e `IncidentList`; aqui ficam só os textos e os seletores.
 */

/** Identificadores das áreas destacadas — viram `data-tour="<id>"` no DOM. */
export type TourTarget = 'kpis' | 'filters' | 'list';

export interface TourStep {
  target: TourTarget;
  /** Título do cartão. O primeiro passo é a saudação. */
  title: string;
  /** Explicação da área destacada. */
  body: string;
}

export const TOUR_STEPS = [
  {
    target: 'kpis',
    title: 'Boas-vindas ao Logos',
    body: 'O resumo em tempo real. Quantos incidentes estão em cada etapa — clique para filtrar a fila.',
  },
  {
    target: 'filters',
    title: 'Busca e filtros',
    body: 'Ache o incidente certo. Filtre por criticidade, status ou categoria — o filtro fica na URL, então o link é compartilhável.',
  },
  {
    target: 'list',
    title: 'Fila priorizada',
    body: 'A fila já vem ordenada por prioridade e SLA. Use j e k para navegar, Enter para abrir e / para buscar.',
  },
] as const satisfies readonly TourStep[];

/** Seletor do alvo de um passo — a única forma de descobrir a área. */
export function tourSelector(target: TourTarget): string {
  return `[data-tour="${target}"]`;
}
