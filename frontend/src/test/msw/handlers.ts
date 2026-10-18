import { HttpResponse, http } from 'msw';

import { PASSWORD_MIN_LENGTH } from '@/features/auth/schemas';
import {
  CATEGORY_LABELS,
  CRITICALITY_LABELS,
  SORT_LABELS,
  STATUS_LABELS,
} from '@/features/incidents/labels';
import { computePriorityScore } from '@/features/incidents/priority';
import {
  firstIssueMessage,
  incidentCreateSchema,
  statusChangeRequestSchema,
} from '@/features/incidents/schemas';
import { getAllowedTransitions, isTransitionAllowed } from '@/features/incidents/statusMachine';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_CRITICALITIES,
  INCIDENT_PAGE_SIZE,
  INCIDENT_SORTS,
  INCIDENT_STATUSES,
  isClosedStatus,
  type Incident,
  type IncidentCriticality,
  type IncidentStatus,
} from '@/features/incidents/types';

import { MOCK_INCIDENT_COUNT, createIncidentFixtures } from '../factories';
import { apiError, apiPath, simulateLatency } from './http';
import {
  accountHandlers,
  authenticateMockAccount,
  checkMockPassword,
  completeMockPasswordChange,
  findMockAccountByPassword,
  readLastAuthenticatedEmail,
} from './users';

/**
 * API simulada (MSW) usada quando o backend não está no ar.
 * O "banco" vive no `localStorage`, então duas abas compartilham o mesmo estado
 * — é assim que o conflito 409 pode ser demonstrado sem backend real.
 */

const STORAGE_KEY = 'logos.mock.incidents.v1';

let database: Incident[] | null = null;

/** Contas de acesso: handlers e "banco" ficam em `./users`. */
export { resetMockAccounts } from './users';

function pad(value: number, size: number): string {
  return String(value).padStart(size, '0');
}

/* ------------------------------------------------------------------ */
/* "Banco" em memória + localStorage                                   */
/* ------------------------------------------------------------------ */

function readStorage(): Incident[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as Incident[];
  } catch {
    // Storage indisponível ou corrompido: recomeça com dados de demonstração.
    return null;
  }
}

function writeStorage(incidents: Incident[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(incidents));
  } catch {
    // Sem persistência o mock continua funcionando só na memória.
  }
}

export function getMockIncidents(): Incident[] {
  if (database === null) {
    database = readStorage() ?? createIncidentFixtures(MOCK_INCIDENT_COUNT);
    writeStorage(database);
  }
  return database;
}

export function resetMockDatabase(
  incidents: Incident[] = createIncidentFixtures(MOCK_INCIDENT_COUNT),
): void {
  database = incidents;
  writeStorage(database);
}

function persistIncidents(incidents: Incident[]): void {
  database = incidents;
  writeStorage(incidents);
}

/* ------------------------------------------------------------------ */
/* Listagem                                                            */
/* ------------------------------------------------------------------ */

const CRITICALITY_ORDER: Record<IncidentCriticality, number> = { ALTA: 3, MEDIA: 2, BAIXA: 1 };

function parseCsvParam(value: string | null): string[] {
  if (value === null || value === '') return [];
  return value
    .split(',')
    .map((chunk) => chunk.trim().toUpperCase())
    .filter((chunk) => chunk !== '');
}

interface ListQuery {
  statuses: string[];
  criticalities: string[];
  categories: string[];
  search: string;
  sort: string;
}

function readListQuery(url: URL): ListQuery {
  return {
    statuses: parseCsvParam(url.searchParams.get('status')),
    criticalities: parseCsvParam(url.searchParams.get('criticality')),
    categories: parseCsvParam(url.searchParams.get('category')),
    search: (url.searchParams.get('search') ?? '').trim(),
    sort: url.searchParams.get('sort') ?? 'priority_desc',
  };
}

function filterIncidents(incidents: Incident[], query: ListQuery): Incident[] {
  const search = query.search.toLowerCase();
  return incidents.filter((incident) => {
    if (query.statuses.length > 0 && !query.statuses.includes(incident.status)) return false;
    if (query.criticalities.length > 0 && !query.criticalities.includes(incident.criticality))
      return false;
    if (query.categories.length > 0 && !query.categories.includes(incident.category)) return false;
    if (search !== '') {
      const haystack = [
        incident.code,
        incident.title,
        incident.locationLabel ?? '',
        incident.truckPlate ?? '',
        incident.driverName ?? '',
        incident.reportedBy,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function sortIncidents(incidents: Incident[], sort: string): Incident[] {
  const sorted = [...incidents];
  switch (sort) {
    case 'created_desc':
      sorted.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      break;
    case 'created_asc':
      sorted.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      break;
    case 'criticality_desc':
      sorted.sort(
        (left, right) =>
          CRITICALITY_ORDER[right.criticality] - CRITICALITY_ORDER[left.criticality] ||
          right.priorityScore - left.priorityScore,
      );
      break;
    default:
      sorted.sort(
        (left, right) =>
          right.priorityScore - left.priorityScore ||
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
      break;
  }
  return sorted;
}

function encodeCursor(index: number): string {
  return btoa(JSON.stringify({ p: index }));
}

function decodeCursor(raw: string | null): number {
  if (raw === null || raw === '') return 0;
  try {
    const match = /"p":(\d+)/.exec(atob(raw));
    const parsed = match?.[1] === undefined ? Number.NaN : Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function readParam(value: string | readonly string[] | undefined): string | null {
  if (value === undefined) return null;
  return typeof value === 'string' ? value : (value[0] ?? null);
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

/** Mesma validade do contrato real (8 h) — aqui só para o token ter prazo. */
const MOCK_TOKEN_TTL_SECONDS = 8 * 60 * 60;

function readLoginField(
  body: unknown,
  key: 'email' | 'password' | 'currentPassword' | 'newPassword',
): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

export const handlers = [
  /**
   * Autenticação simulada.
   *
   * Aceita a senha da conta (as mesmas do seed da API) e a temporária do
   * convite. A segunda entra em primeiro acesso: a resposta vem com
   * `mustChangePassword: true` e a interface troca a triagem pela tela de
   * definir senha.
   */
  http.post(apiPath('/auth/login'), async ({ request }) => {
    await simulateLatency();

    const body: unknown = await request.json().catch(() => null);
    const email = readLoginField(body, 'email')?.trim().toLowerCase() ?? '';
    const password = readLoginField(body, 'password') ?? '';

    const authenticated = authenticateMockAccount(email, password);
    if (authenticated === null) {
      return apiError(401, 'INVALID_CREDENTIALS', 'Credenciais inválidas.', null, {
        'WWW-Authenticate': 'Bearer',
      });
    }

    return HttpResponse.json({
      accessToken: `mock-token-${String(Date.now())}`,
      tokenType: 'Bearer',
      expiresIn: MOCK_TOKEN_TTL_SECONDS,
      mustChangePassword: authenticated.mustChangePassword,
      user: {
        id: authenticated.account.id,
        email: authenticated.account.email,
        name: authenticated.account.name,
        role: authenticated.role,
        // O último acesso mostrado é o ANTERIOR, como no backend.
        lastLoginAt: authenticated.previousLoginAt,
      },
    });
  }),

  /**
   * Troca de senha: 204, conclui o convite e aplica a política mínima.
   *
   * A senha atual é conferida, como na API — é ela que separa a troca
   * voluntária do menu (#126) do primeiro acesso do convite (#128): nas duas o
   * corpo traz `currentPassword` (a vigente, ou a temporária do convite). O
   * token do mock não carrega identidade, então a conta é a da última
   * autenticação ou, quando o teste montou a sessão direto no store sem passar
   * pelo login, a dona da senha informada.
   */
  http.post(apiPath('/auth/change-password'), async ({ request }) => {
    await simulateLatency();
    const body: unknown = await request.json().catch(() => null);
    const currentPassword = readLoginField(body, 'currentPassword') ?? '';
    const newPassword = readLoginField(body, 'newPassword') ?? '';

    const email = readLastAuthenticatedEmail() ?? findMockAccountByPassword(currentPassword);
    if (email === null || !checkMockPassword(email, currentPassword)) {
      return apiError(401, 'INVALID_CREDENTIALS', 'A senha atual está incorreta.', null, {
        'WWW-Authenticate': 'Bearer',
      });
    }

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      return apiError(422, 'WEAK_PASSWORD', 'A senha não atende à política mínima.', {
        minLength: PASSWORD_MIN_LENGTH,
        received: newPassword.length,
      });
    }

    completeMockPasswordChange(email, newPassword);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(apiPath('/auth/logout'), () => new HttpResponse(null, { status: 204 })),

  http.get(apiPath('/health/live'), () => HttpResponse.json({ status: 'ok' })),

  http.get(apiPath('/health/ready'), () => HttpResponse.json({ status: 'ready', database: 'ok' })),

  http.get(apiPath('/meta/enums'), async () => {
    await simulateLatency();
    return HttpResponse.json({
      categories: INCIDENT_CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
      criticalities: INCIDENT_CRITICALITIES.map((value) => ({
        value,
        label: CRITICALITY_LABELS[value],
      })),
      statuses: INCIDENT_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
      sorts: INCIDENT_SORTS.map((value) => ({ value, label: SORT_LABELS[value] })),
    });
  }),

  http.get(apiPath('/incidents'), async ({ request }) => {
    await simulateLatency();
    const url = new URL(request.url);
    const query = readListQuery(url);
    const filtered = sortIncidents(filterIncidents(getMockIncidents(), query), query.sort);
    const limit = Number.parseInt(url.searchParams.get('limit') ?? String(INCIDENT_PAGE_SIZE), 10);
    const pageSize = Number.isFinite(limit) && limit > 0 ? limit : INCIDENT_PAGE_SIZE;
    const startIndex = decodeCursor(url.searchParams.get('cursor'));
    const page = filtered.slice(startIndex, startIndex + pageSize);
    const nextIndex = startIndex + page.length;
    const hasNextPage = nextIndex < filtered.length;

    return HttpResponse.json({
      items: page,
      pageInfo: {
        nextCursor: hasNextPage ? encodeCursor(nextIndex) : null,
        hasNextPage,
        limit: pageSize,
      },
      meta: {
        total: filtered.length,
        appliedFilters: {
          status: query.statuses,
          criticality: query.criticalities,
          category: query.categories,
          search: query.search,
          sort: query.sort,
        },
      },
    });
  }),

  http.get(apiPath('/incidents/:id'), async ({ params }) => {
    await simulateLatency();
    const id = readParam(params.id);
    const incident = getMockIncidents().find((candidate) => candidate.id === id);
    if (incident === undefined) {
      return apiError(404, 'INCIDENT_NOT_FOUND', 'Incidente não encontrado.');
    }
    return HttpResponse.json(incident, { headers: { ETag: `"${String(incident.version)}"` } });
  }),

  http.post(apiPath('/incidents/:id/status'), async ({ params, request }) => {
    await simulateLatency();
    const id = readParam(params.id);
    const incidents = getMockIncidents();
    const incident = incidents.find((candidate) => candidate.id === id);
    if (incident === undefined) {
      return apiError(404, 'INCIDENT_NOT_FOUND', 'Incidente não encontrado.');
    }

    const ifMatch = request.headers.get('If-Match');
    if (ifMatch === null) {
      return apiError(
        428,
        'IF_MATCH_REQUIRED',
        'O header If-Match é obrigatório para mudar o status.',
      );
    }
    const expectedVersion = Number.parseInt(ifMatch.replace(/"/g, ''), 10);

    const payload: unknown = await request.json();
    const parsed = statusChangeRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return apiError(422, 'VALIDATION_ERROR', firstIssueMessage(parsed.error), {
        issues: parsed.error.issues,
      });
    }

    if (!Number.isFinite(expectedVersion) || expectedVersion !== incident.version) {
      return apiError(
        409,
        'VERSION_CONFLICT',
        `O incidente foi alterado por outro analista (versão atual ${String(incident.version)}).`,
        { current: incident, expectedVersion },
      );
    }

    const nextStatus: IncidentStatus = parsed.data.status;
    if (!isTransitionAllowed(incident.status, nextStatus)) {
      return apiError(
        422,
        'INVALID_STATUS_TRANSITION',
        `Não é possível ir de ${incident.status} para ${nextStatus}.`,
        {
          from: incident.status,
          to: nextStatus,
          allowed: getAllowedTransitions(incident.status),
        },
      );
    }

    const now = new Date().toISOString();
    const updated: Incident = {
      ...incident,
      status: nextStatus,
      resolutionNotes: parsed.data.resolutionNotes ?? incident.resolutionNotes,
      assignedAnalyst:
        nextStatus === 'EM_INVESTIGACAO' ? 'Alysson Araújo' : incident.assignedAnalyst,
      closedAt: isClosedStatus(nextStatus) ? now : null,
      updatedAt: now,
      version: incident.version + 1,
    };

    persistIncidents(incidents.map((candidate) => (candidate.id === id ? updated : candidate)));
    return HttpResponse.json(updated, { headers: { ETag: `"${String(updated.version)}"` } });
  }),

  http.post(apiPath('/incidents'), async ({ request }) => {
    await simulateLatency();
    const payload: unknown = await request.json();
    const parsed = incidentCreateSchema.safeParse(payload);
    if (!parsed.success) {
      return apiError(422, 'VALIDATION_ERROR', firstIssueMessage(parsed.error), {
        issues: parsed.error.issues,
      });
    }

    const incidents = getMockIncidents();
    const nextIndex = incidents.length + 1;
    const createdAt = new Date();
    const slaHours =
      parsed.data.criticality === 'ALTA' ? 3 : parsed.data.criticality === 'MEDIA' ? 8 : 24;
    const draft: Incident = {
      id: `mock-${String(nextIndex)}`,
      code: `INC-2026-${pad(nextIndex, 6)}`,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      category: parsed.data.category,
      criticality: parsed.data.criticality,
      status: 'ABERTO',
      latitude: null,
      longitude: null,
      locationLabel: parsed.data.locationLabel ?? null,
      truckPlate: parsed.data.truckPlate ?? null,
      driverName: parsed.data.driverName ?? null,
      reportedBy: parsed.data.reportedBy,
      assignedAnalyst: null,
      resolutionNotes: null,
      priorityScore: 0,
      slaDueAt: new Date(createdAt.getTime() + slaHours * 3_600_000).toISOString(),
      version: 1,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      closedAt: null,
    };
    const incident: Incident = { ...draft, priorityScore: computePriorityScore(draft) };
    persistIncidents([incident, ...incidents]);
    return HttpResponse.json(incident, { status: 201, headers: { ETag: '"1"' } });
  }),

  http.delete(apiPath('/incidents/:id'), async ({ params }) => {
    await simulateLatency();
    const id = readParam(params.id);
    const incidents = getMockIncidents();
    if (!incidents.some((candidate) => candidate.id === id)) {
      return apiError(404, 'INCIDENT_NOT_FOUND', 'Incidente não encontrado.');
    }
    persistIncidents(incidents.filter((candidate) => candidate.id !== id));
    return new HttpResponse(null, { status: 204 });
  }),

  // Administração de contas (`GET/POST/PATCH /users`).
  ...accountHandlers,
];
