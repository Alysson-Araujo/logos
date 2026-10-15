import type {
  IncidentCategory,
  IncidentCriticality,
  IncidentFilters,
  IncidentSort,
  IncidentStatus,
} from './types';

/** Rótulos PT-BR exibidos na interface (o código continua em inglês). */
export const CRITICALITY_LABELS: Record<IncidentCriticality, string> = {
  ALTA: 'Alta',
  MEDIA: 'Média',
  BAIXA: 'Baixa',
};

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  ABERTO: 'Aberto',
  EM_INVESTIGACAO: 'Em Investigação',
  FECHADO: 'Fechado',
  INCONCLUSIVO: 'Inconclusivo',
};

export const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  ACIDENTE_COM_VEICULO: 'Acidente com Veículo',
  ACIDENTE_COM_VITIMAS: 'Acidente com Vítimas',
  CONDICAO_CLIMATICA_ATIPICA: 'Condição Climática Atípica',
  PROBLEMA_MECANICO: 'Problema Mecânico',
  BLOQUEIO_DE_PISTA: 'Bloqueio de Pista',
};

/** Versão curta para a lista densa. */
export const CATEGORY_SHORT_LABELS: Record<IncidentCategory, string> = {
  ACIDENTE_COM_VEICULO: 'Acidente',
  ACIDENTE_COM_VITIMAS: 'Vítimas',
  CONDICAO_CLIMATICA_ATIPICA: 'Clima',
  PROBLEMA_MECANICO: 'Mecânico',
  BLOQUEIO_DE_PISTA: 'Bloqueio',
};

export const SORT_LABELS: Record<IncidentSort, string> = {
  priority_desc: 'Prioridade',
  created_desc: 'Mais recentes',
  created_asc: 'Mais antigos',
  criticality_desc: 'Criticidade',
};

/** Texto do botão que dispara cada transição de status. */
export const TRANSITION_ACTION_LABELS: Record<IncidentStatus, string> = {
  ABERTO: 'Devolver para a fila',
  EM_INVESTIGACAO: 'Assumir investigação',
  FECHADO: 'Fechar caso',
  INCONCLUSIVO: 'Marcar como inconclusivo',
};

/** Resumo legível dos filtros ativos — usado no empty state filtrado. */
export function describeActiveFilters(filters: IncidentFilters): string[] {
  const parts: string[] = [];
  if (filters.criticalities.length > 0) {
    parts.push(filters.criticalities.map((value) => CRITICALITY_LABELS[value]).join(' · '));
  }
  if (filters.categories.length > 0) {
    parts.push(filters.categories.map((value) => CATEGORY_LABELS[value]).join(' · '));
  }
  if (filters.statuses.length > 0) {
    parts.push(filters.statuses.map((value) => STATUS_LABELS[value]).join(' · '));
  }
  if (filters.search.trim() !== '') {
    parts.push(`"${filters.search.trim()}"`);
  }
  return parts;
}
