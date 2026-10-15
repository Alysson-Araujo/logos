/**
 * Ambiente `node` de propósito: o `fetch` do Node (undici) só aceita um
 * `AbortSignal` do mesmo realm, e o MSW roda no processo do Node.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { isApiError, isVersionConflict } from '@/lib/http';

import { DEFAULT_INCIDENT_FILTERS, type Incident } from '../types';
import {
  changeIncidentStatus,
  fetchIncidentById,
  fetchIncidentList,
  readConflictServerState,
} from './endpoints';

/** Estes testes passam pela API simulada (MSW), não por `fetch` mockado à mão. */

async function firstWithStatus(status: Incident['status']): Promise<Incident> {
  const page = await fetchIncidentList({
    filters: { ...DEFAULT_INCIDENT_FILTERS, statuses: [status] },
    cursor: null,
    limit: 1,
  });
  const incident = page.items[0];
  if (incident === undefined) {
    throw new Error(`Nenhum incidente com status ${status} nos dados de mock.`);
  }
  return incident;
}

describe('endpoints de incidentes (via MSW)', () => {
  it('lista paginada por cursor com validação Zod do envelope', async () => {
    const firstPage = await fetchIncidentList({
      filters: DEFAULT_INCIDENT_FILTERS,
      cursor: null,
      limit: 10,
    });

    expect(firstPage.items).toHaveLength(10);
    expect(firstPage.meta.total).toBe(120);
    expect(firstPage.pageInfo.hasNextPage).toBe(true);
    expect(firstPage.pageInfo.nextCursor).not.toBeNull();

    const secondPage = await fetchIncidentList({
      filters: DEFAULT_INCIDENT_FILTERS,
      cursor: firstPage.pageInfo.nextCursor,
      limit: 10,
    });

    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
  });

  it('ordena por prioridade decrescente no modo padrão', async () => {
    const page = await fetchIncidentList({
      filters: DEFAULT_INCIDENT_FILTERS,
      cursor: null,
      limit: 20,
    });
    const scores = page.items.map((incident) => incident.priorityScore);

    expect([...scores].sort((left, right) => right - left)).toEqual(scores);
  });

  it('filtra criticidade e categoria em CSV no servidor', async () => {
    const page = await fetchIncidentList({
      filters: {
        ...DEFAULT_INCIDENT_FILTERS,
        criticalities: ['ALTA'],
        categories: ['BLOQUEIO_DE_PISTA'],
      },
      cursor: null,
    });

    expect(page.items.length).toBeGreaterThan(0);
    expect(
      page.items.every(
        (incident) => incident.criticality === 'ALTA' && incident.category === 'BLOQUEIO_DE_PISTA',
      ),
    ).toBe(true);
  });

  it('devolve ETag igual à versão no detalhe', async () => {
    const page = await fetchIncidentList({
      filters: DEFAULT_INCIDENT_FILTERS,
      cursor: null,
      limit: 1,
    });
    const reference = page.items[0];
    expect(reference).toBeDefined();
    if (reference === undefined) return;

    const detail = await fetchIncidentById(reference.id);

    expect(detail.incident.id).toBe(reference.id);
    expect(detail.etag).toBe(`"${String(detail.incident.version)}"`);
  });

  it('responde 409 com a representação ATUAL quando o If-Match está velho', async () => {
    const target = await firstWithStatus('ABERTO');

    const captured = await changeIncidentStatus({
      id: target.id,
      request: { status: 'EM_INVESTIGACAO' },
      version: target.version + 3,
      idempotencyKey: 'teste-conflito',
    }).catch((cause: unknown) => cause);

    expect(isVersionConflict(captured)).toBe(true);

    const serverState = readConflictServerState(captured);
    expect(serverState?.id).toBe(target.id);
    expect(serverState?.version).toBe(target.version);
  });

  it('aplica a transição e incrementa a versão quando o If-Match confere', async () => {
    const target = await firstWithStatus('ABERTO');

    const updated = await changeIncidentStatus({
      id: target.id,
      request: { status: 'EM_INVESTIGACAO' },
      version: target.version,
      idempotencyKey: 'teste-sucesso',
    });

    expect(updated.status).toBe('EM_INVESTIGACAO');
    expect(updated.version).toBe(target.version + 1);
  });

  it('exige justificativa com 10+ caracteres para FECHADO', async () => {
    const target = await firstWithStatus('ABERTO');

    const captured = await changeIncidentStatus({
      id: target.id,
      request: { status: 'FECHADO' },
      version: target.version,
      idempotencyKey: 'teste-notas',
    }).catch((cause: unknown) => cause);

    expect(isApiError(captured)).toBe(true);
    if (isApiError(captured)) {
      expect(captured.status).toBe(422);
      expect(captured.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejeita transição proibida com 422 INVALID_STATUS_TRANSITION', async () => {
    const target = await firstWithStatus('FECHADO');

    const captured = await changeIncidentStatus({
      id: target.id,
      request: { status: 'EM_INVESTIGACAO' },
      version: target.version,
      idempotencyKey: 'teste-transicao',
    }).catch((cause: unknown) => cause);

    expect(isApiError(captured)).toBe(true);
    if (isApiError(captured)) {
      expect(captured.status).toBe(422);
      expect(captured.code).toBe('INVALID_STATUS_TRANSITION');
    }
  });
});
