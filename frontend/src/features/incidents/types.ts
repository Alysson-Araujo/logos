/** Enums e tipos do contrato da API. Espelham `backend/app/domain/enums.py`. */

export const INCIDENT_CATEGORIES = [
  'ACIDENTE_COM_VEICULO',
  'ACIDENTE_COM_VITIMAS',
  'CONDICAO_CLIMATICA_ATIPICA',
  'PROBLEMA_MECANICO',
  'BLOQUEIO_DE_PISTA',
] as const;

export const INCIDENT_CRITICALITIES = ['ALTA', 'MEDIA', 'BAIXA'] as const;

export const INCIDENT_STATUSES = ['ABERTO', 'EM_INVESTIGACAO', 'FECHADO', 'INCONCLUSIVO'] as const;

export const INCIDENT_SORTS = [
  'priority_desc',
  'created_desc',
  'created_asc',
  'criticality_desc',
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];
export type IncidentCriticality = (typeof INCIDENT_CRITICALITIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export type IncidentSort = (typeof INCIDENT_SORTS)[number];

/** DTO do incidente — camelCase, exatamente como a API devolve. */
export interface Incident {
  id: string;
  code: string;
  title: string;
  description: string | null;
  category: IncidentCategory;
  criticality: IncidentCriticality;
  status: IncidentStatus;
  latitude: number | null;
  longitude: number | null;
  locationLabel: string | null;
  truckPlate: string | null;
  driverName: string | null;
  reportedBy: string;
  assignedAnalyst: string | null;
  resolutionNotes: string | null;
  priorityScore: number;
  slaDueAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface IncidentPageInfo {
  nextCursor: string | null;
  hasNextPage: boolean;
  limit: number;
}

export interface IncidentListMeta {
  total: number;
  appliedFilters: Record<string, unknown>;
}

export interface IncidentListResponse {
  items: Incident[];
  pageInfo: IncidentPageInfo;
  meta: IncidentListMeta;
}

/** Estado de filtros — serializado na query string para virar link compartilhável. */
export interface IncidentFilters {
  statuses: IncidentStatus[];
  criticalities: IncidentCriticality[];
  categories: IncidentCategory[];
  search: string;
  sort: IncidentSort;
}

export const DEFAULT_INCIDENT_FILTERS: IncidentFilters = {
  statuses: [],
  criticalities: [],
  categories: [],
  search: '',
  sort: 'priority_desc',
};

export const INCIDENT_PAGE_SIZE = 50;

/** Mutações de status que exigem justificativa (mín. 10 caracteres). */
export const RESOLUTION_NOTES_MIN_LENGTH = 10;

export function requiresResolutionNotes(status: IncidentStatus): boolean {
  return status === 'FECHADO' || status === 'INCONCLUSIVO';
}

export function isClosedStatus(status: IncidentStatus): boolean {
  return status === 'FECHADO' || status === 'INCONCLUSIVO';
}

export interface StatusChangeRequest {
  status: IncidentStatus;
  resolutionNotes?: string;
}

/** O que o analista tentou mudar (usado no modal de conflito). */
export interface ConflictAttempt {
  status: IncidentStatus;
  resolutionNotes: string | null;
  /** Versão que o analista tinha na tela quando tentou salvar. */
  viewedVersion: number;
  attemptedAt: string;
}

/** Estado atual no servidor devolvido no `409 VERSION_CONFLICT`. */
export interface ConflictState {
  attempted: ConflictAttempt;
  server: Incident;
  message: string;
  requestId: string | null;
}

export interface NewIncidentInput {
  title: string;
  category: IncidentCategory;
  criticality: IncidentCriticality;
  description?: string;
  locationLabel?: string;
  truckPlate?: string;
  driverName?: string;
  reportedBy: string;
}
