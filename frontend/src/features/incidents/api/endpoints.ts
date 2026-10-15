import { isVersionConflict, type QueryParams } from '@/lib/http';

import { incidentListResponseSchema, incidentSchema, parseContract } from '../schemas';
import {
  INCIDENT_PAGE_SIZE,
  type Incident,
  type IncidentFilters,
  type IncidentListResponse,
  type IncidentStatus,
  type StatusChangeRequest,
} from '../types';
import { httpClient } from './client';

export interface IncidentDetailResult {
  incident: Incident;
  /** ETag devolvido pelo `GET /incidents/{id}` (formato `"3"`). */
  etag: string | null;
}

/** Query string exatamente como o contrato define (CSV nos campos multi-valor). */
export function buildIncidentQueryParams(
  filters: IncidentFilters,
  cursor: string | null,
  limit: number = INCIDENT_PAGE_SIZE,
): QueryParams {
  const search = filters.search.trim();
  return {
    status: filters.statuses,
    criticality: filters.criticalities,
    category: filters.categories,
    search: search === '' ? undefined : search,
    sort: filters.sort,
    limit,
    cursor: cursor ?? undefined,
  };
}

export interface FetchIncidentListParams {
  filters: IncidentFilters;
  cursor: string | null;
  limit?: number;
  signal?: AbortSignal;
}

export async function fetchIncidentList({
  filters,
  cursor,
  limit,
  signal,
}: FetchIncidentListParams): Promise<IncidentListResponse> {
  const raw = await httpClient.get('/incidents', {
    query: buildIncidentQueryParams(filters, cursor, limit),
    signal,
  });
  return parseContract(incidentListResponseSchema, raw);
}

export async function fetchIncidentById(
  id: string,
  signal?: AbortSignal,
): Promise<IncidentDetailResult> {
  const result = await httpClient.getWithMeta(`/incidents/${encodeURIComponent(id)}`, { signal });
  return { incident: parseContract(incidentSchema, result.data), etag: result.etag };
}

/** Usado pelos KPI cards: uma leitura enxuta por status, só para ler `meta.total`. */
export async function fetchIncidentCountByStatus(
  status: IncidentStatus,
  signal?: AbortSignal,
): Promise<number> {
  const raw = await httpClient.get('/incidents', { query: { status, limit: 1 }, signal });
  return parseContract(incidentListResponseSchema, raw).meta.total;
}

export interface ChangeIncidentStatusParams {
  id: string;
  request: StatusChangeRequest;
  /** Versão que o analista viu — vira `If-Match: "N"`. */
  version: number;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export async function changeIncidentStatus({
  id,
  request,
  version,
  idempotencyKey,
  signal,
}: ChangeIncidentStatusParams): Promise<Incident> {
  const raw = await httpClient.post(
    `/incidents/${encodeURIComponent(id)}/status`,
    buildStatusChangeBody(request),
    { ifMatch: version, idempotencyKey, signal },
  );
  return parseContract(incidentSchema, raw);
}

function buildStatusChangeBody(request: StatusChangeRequest): Record<string, unknown> {
  const notes = request.resolutionNotes?.trim();
  if (notes === undefined || notes === '') return { status: request.status };
  return { status: request.status, resolutionNotes: notes };
}

/**
 * Extrai a representação ATUAL do incidente de um `409 VERSION_CONFLICT`
 * (`error.details.current`) para montar o diff no modal de conflito.
 */
export function readConflictServerState(error: unknown): Incident | null {
  if (!isVersionConflict(error)) return null;
  const details = error.details;
  if (typeof details !== 'object' || details === null) return null;
  const current = (details as Record<string, unknown>).current;
  const result = incidentSchema.safeParse(current);
  return result.success ? result.data : null;
}
