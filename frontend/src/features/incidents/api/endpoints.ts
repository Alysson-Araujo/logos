import { isApiError, isVersionConflict, type QueryParams } from '@/lib/http';

import {
  CREATE_INCIDENT_FIELDS,
  incidentListResponseSchema,
  incidentSchema,
  parseContract,
  type CreateIncidentField,
} from '../schemas';
import {
  INCIDENT_PAGE_SIZE,
  type Incident,
  type IncidentFilters,
  type IncidentListResponse,
  type IncidentStatus,
  type NewIncidentInput,
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

export interface CreateIncidentParams {
  input: NewIncidentInput;
  /** Chave estável da tentativa: reenviar o mesmo formulário não duplica o caso. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function createIncident({
  input,
  idempotencyKey,
  signal,
}: CreateIncidentParams): Promise<Incident> {
  const raw = await httpClient.post('/incidents', buildCreateBody(input), {
    idempotencyKey,
    signal,
  });
  return parseContract(incidentSchema, raw);
}

/** Só campo preenchido viaja: opcional vazio não vira string vazia no registro. */
function buildCreateBody(input: NewIncidentInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: input.title.trim(),
    category: input.category,
    criticality: input.criticality,
    reportedBy: input.reportedBy.trim(),
  };

  const optionalFields: [string, string | undefined][] = [
    ['description', input.description],
    ['locationLabel', input.locationLabel],
    ['truckPlate', input.truckPlate],
    ['driverName', input.driverName],
  ];
  for (const [key, value] of optionalFields) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed !== '') body[key] = trimmed;
  }

  return body;
}

/** Erro de validação atribuído a um campo do formulário de criação. */
export interface IncidentFieldError {
  field: CreateIncidentField;
  message: string;
}

/** Formato bruto de um item de erro, nas duas formas que a API já devolveu. */
interface RawFieldIssue {
  path: string[];
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringPath(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Lê a lista de erros de um `details`.
 *
 * Convive com as duas formas em circulação: `issues` (índice `path`, o que o
 * mock do MSW devolve a partir do Zod) e `validationErrors` (índice `loc`, o
 * formato do FastAPI, que prefixa o campo com `body`).
 */
function readRawIssues(details: Record<string, unknown>): RawFieldIssue[] {
  const sources: [string, string, string][] = [
    ['issues', 'path', 'message'],
    ['validationErrors', 'loc', 'msg'],
  ];

  const issues: RawFieldIssue[] = [];
  for (const [listKey, pathKey, messageKey] of sources) {
    const list = details[listKey];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isRecord(item)) continue;
      const message = item[messageKey];
      issues.push({
        path: toStringPath(item[pathKey]),
        message: typeof message === 'string' && message.trim() !== '' ? message : 'Valor inválido.',
      });
    }
  }
  return issues;
}

/** Último segmento do caminho: `['body', 'title']` e `['title']` caem em `title`. */
function toCreateIncidentField(path: readonly string[]): CreateIncidentField | null {
  const last = path[path.length - 1];
  if (last === undefined) return null;
  return CREATE_INCIDENT_FIELDS.find((field) => field === last) ?? null;
}

/**
 * Traduz um `422 VALIDATION_ERROR` em erros por campo (um por campo, o
 * primeiro que vier). Erro sem campo identificável fica de fora: a tela o
 * mostra como mensagem geral.
 */
export function readIncidentFieldErrors(error: unknown): IncidentFieldError[] {
  if (!isApiError(error) || !isRecord(error.details)) return [];

  const result: IncidentFieldError[] = [];
  for (const issue of readRawIssues(error.details)) {
    const field = toCreateIncidentField(issue.path);
    if (field === null || result.some((entry) => entry.field === field)) continue;
    result.push({ field, message: issue.message });
  }
  return result;
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
