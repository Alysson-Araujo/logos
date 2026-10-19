import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createQueryClient } from '@/lib/queryClient';
import { createIncidentFixture } from '@/test/factories';
import { server } from '@/test/setup';

import { DEFAULT_INCIDENT_FILTERS, type Incident, type IncidentFilters } from '../types';
import {
  incidentQueryKeys,
  normalizeFilterKey,
  useIncidentCounters,
  useIncidentDetail,
  useIncidentList,
} from './useIncidents';

/**
 * Leituras de incidente: lista paginada, KPIs e detalhe.
 *
 * O que este teste protege: as três coisas que fazem a triagem parecer rápida ou
 * quebrada. A **chave de cache** — se duas combinações de filtro diferentes
 * caírem na mesma entrada, a lista mostra o resultado do filtro anterior; se a
 * mesma seleção em ordem diferente gerar duas entradas, a volta instantânea se
 * perde e a API leva duas consultas pelo mesmo dado. O **contador** — os quatro
 * KPIs do topo são quatro leituras independentes: uma falhando, o total não pode
 * sair errado nem o carregamento ficar preso. E o **detalhe desabilitado** — o
 * drawer fechado não pode gastar requisição nenhuma.
 */

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Espera de relógio real, para as asserções de ausência (nada foi repetido). */
async function esperar(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface ListCall {
  search: string;
  status: string;
  criticality: string;
  sort: string;
  limit: string;
  cursor: string | null;
}

const listCalls: ListCall[] = [];

beforeEach(() => {
  listCalls.length = 0;
});

/** Serve `GET /incidents` paginando por índice de página codificado no cursor. */
function serveIncidentPages(pages: readonly (readonly Incident[])[]): void {
  server.use(
    http.get('*/incidents', ({ request }) => {
      const url = new URL(request.url);
      const cursor = url.searchParams.get('cursor');
      listCalls.push({
        search: url.searchParams.get('search') ?? '',
        status: url.searchParams.get('status') ?? '',
        criticality: url.searchParams.get('criticality') ?? '',
        sort: url.searchParams.get('sort') ?? '',
        limit: url.searchParams.get('limit') ?? '',
        cursor,
      });

      const index = cursor === null ? 0 : Number.parseInt(cursor, 10);
      const items = pages[index] ?? [];
      const hasNextPage = index + 1 < pages.length;
      return HttpResponse.json({
        items,
        pageInfo: { nextCursor: hasNextPage ? String(index + 1) : null, hasNextPage, limit: 50 },
        meta: { total: pages.reduce((sum, page) => sum + page.length, 0) },
      });
    }),
  );
}

describe('chaves de cache da lista', () => {
  const filtros: IncidentFilters = {
    statuses: ['ABERTO', 'FECHADO'],
    criticalities: ['ALTA', 'BAIXA'],
    categories: [],
    search: '  BR-116 ',
    sort: 'priority_desc',
  };

  it('a mesma seleção em ordem diferente cai na mesma entrada', () => {
    const reordenado: IncidentFilters = {
      ...filtros,
      statuses: ['FECHADO', 'ABERTO'],
      criticalities: ['BAIXA', 'ALTA'],
    };

    // Sem a serialização estável, marcar dois filtros na ordem inversa criaria
    // uma segunda entrada de cache e uma segunda consulta para o mesmo dado.
    expect(normalizeFilterKey(reordenado)).toBe(normalizeFilterKey(filtros));
  });

  it('normaliza a busca: aparar e caixa não criam entradas distintas', () => {
    expect(normalizeFilterKey({ ...filtros, search: 'br-116' })).toBe(normalizeFilterKey(filtros));
    expect(normalizeFilterKey({ ...filtros, search: 'BR-116' })).toBe(normalizeFilterKey(filtros));
  });

  it('filtros diferentes não compartilham entrada', () => {
    expect(normalizeFilterKey({ ...filtros, sort: 'created_desc' })).not.toBe(
      normalizeFilterKey(filtros),
    );
    expect(normalizeFilterKey({ ...filtros, statuses: ['ABERTO'] })).not.toBe(
      normalizeFilterKey(filtros),
    );
    expect(normalizeFilterKey({ ...filtros, search: 'BR-101' })).not.toBe(
      normalizeFilterKey(filtros),
    );
  });

  it('as chaves de detalhe e de contador ficam sob o mesmo namespace', () => {
    expect(incidentQueryKeys.list(filtros)[0]).toBe(incidentQueryKeys.all[0]);
    expect(incidentQueryKeys.detail('inc-1')).toEqual(['incidents', 'detail', 'inc-1']);
    expect(incidentQueryKeys.counter('ABERTO')).toEqual(['incidents', 'counters', 'ABERTO']);
    expect(incidentQueryKeys.counters().slice(0, 2)).toEqual(['incidents', 'counters']);
  });
});

describe('useIncidentList', () => {
  it('busca a primeira página e devolve os itens da fila', async () => {
    const pagina = [
      createIncidentFixture({ id: 'inc-1', code: 'INC-2026-000001' }),
      createIncidentFixture({ id: 'inc-2', code: 'INC-2026-000002' }),
    ];
    serveIncidentPages([pagina]);

    const { result } = renderHook(() => useIncidentList(DEFAULT_INCIDENT_FILTERS), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.pages).toHaveLength(1);
    expect(result.current.data?.pages[0]?.items.map((incident) => incident.id)).toEqual([
      'inc-1',
      'inc-2',
    ]);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('busca a página seguinte com o cursor que a anterior devolveu', async () => {
    serveIncidentPages([
      [createIncidentFixture({ id: 'inc-1' })],
      [createIncidentFixture({ id: 'inc-2' })],
    ]);

    const { result } = renderHook(() => useIncidentList(DEFAULT_INCIDENT_FILTERS), {
      wrapper: createWrapper(createQueryClient()),
    });
    await waitFor(() => {
      expect(result.current.hasNextPage).toBe(true);
    });

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.data?.pages).toHaveLength(2);
    });
    expect(result.current.data?.pages.map((page) => page.items[0]?.id)).toEqual(['inc-1', 'inc-2']);
    expect(result.current.hasNextPage).toBe(false);
    // Mais importante que a página em si: o cursor viajou na consulta.
    expect(listCalls.map((call) => call.cursor)).toEqual([null, '1']);
  });

  it('traduz a seleção de filtros para a query string do contrato', async () => {
    serveIncidentPages([[]]);

    const filtros: IncidentFilters = {
      statuses: ['ABERTO', 'EM_INVESTIGACAO'],
      criticalities: ['ALTA'],
      categories: ['BLOQUEIO_DE_PISTA'],
      search: 'BR-116',
      sort: 'created_desc',
    };

    const { result } = renderHook(() => useIncidentList(filtros), {
      wrapper: createWrapper(createQueryClient()),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(listCalls[0]).toEqual({
      search: 'BR-116',
      status: 'ABERTO,EM_INVESTIGACAO',
      criticality: 'ALTA',
      sort: 'created_desc',
      limit: '50',
      cursor: null,
    });
  });

  it('omite da query string o que está vazio, em vez de mandar filtro em branco', async () => {
    serveIncidentPages([[]]);

    const { result } = renderHook(() => useIncidentList(DEFAULT_INCIDENT_FILTERS), {
      wrapper: createWrapper(createQueryClient()),
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(listCalls[0]).toEqual({
      search: '',
      status: '',
      criticality: '',
      sort: 'priority_desc',
      limit: '50',
      cursor: null,
    });
  });
});

describe('useIncidentCounters', () => {
  it('faz uma leitura por status, soma o total e para de carregar', async () => {
    const totais: Record<string, number> = {
      ABERTO: 7,
      EM_INVESTIGACAO: 3,
      FECHADO: 12,
      INCONCLUSIVO: 2,
    };
    server.use(
      http.get('*/incidents', ({ request }) => {
        const status = new URL(request.url).searchParams.get('status') ?? '';
        return HttpResponse.json({
          items: [],
          pageInfo: { nextCursor: null, hasNextPage: false, limit: 1 },
          meta: { total: totais[status] ?? 0 },
        });
      }),
    );

    const { result } = renderHook(() => useIncidentCounters(), {
      wrapper: createWrapper(createQueryClient()),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.total).toBe(0);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.byStatus).toEqual({
      ABERTO: 7,
      EM_INVESTIGACAO: 3,
      FECHADO: 12,
      INCONCLUSIVO: 2,
    });
    // O total do topo é a soma das quatro leituras — nenhuma pode faltar.
    expect(result.current.total).toBe(24);
    expect(result.current.isError).toBe(false);
  });

  it('sinaliza erro sem travar o carregamento quando uma leitura é recusada', async () => {
    const tentativas = new Map<string, number>();
    server.use(
      http.get('*/incidents', ({ request }) => {
        const status = new URL(request.url).searchParams.get('status') ?? '';
        tentativas.set(status, (tentativas.get(status) ?? 0) + 1);
        if (status === 'FECHADO') {
          return HttpResponse.json(
            { error: { code: 'BAD_REQUEST', message: 'Filtro recusado pela API.' } },
            { status: 400 },
          );
        }
        return HttpResponse.json({
          items: [],
          pageInfo: { nextCursor: null, hasNextPage: false, limit: 1 },
          meta: { total: 1 },
        });
      }),
    );

    const { result } = renderHook(() => useIncidentCounters(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.isLoading).toBe(false);
    // O que não falhou continua valendo: um KPI quebrado não apaga os outros.
    expect(result.current.byStatus.ABERTO).toBe(1);
    expect(result.current.byStatus.FECHADO).toBe(0);

    // Um 4xx não é repetido: esperar além da janela de nova tentativa (1 s) é o
    // que prova a ausência de repetição.
    await esperar(1200);
    expect(tentativas.get('FECHADO')).toBe(1);
  });
});

describe('useIncidentDetail', () => {
  it('sem incidente selecionado não consulta nada', async () => {
    let chamadas = 0;
    server.use(
      http.get('*/incidents/:id', () => {
        chamadas += 1;
        return HttpResponse.json(createIncidentFixture());
      }),
    );

    const { result } = renderHook(() => useIncidentDetail(null), {
      wrapper: createWrapper(createQueryClient()),
    });

    // Dar tempo de uma consulta indesejada sair, para a asserção valer.
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(chamadas).toBe(0);
    expect(result.current.data).toBeUndefined();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('busca o incidente e guarda o ETag que veio junto', async () => {
    const incidente = createIncidentFixture({ id: 'inc-9', version: 3 });
    server.use(
      http.get('*/incidents/:id', () => HttpResponse.json(incidente, { headers: { ETag: '"3"' } })),
    );

    const { result } = renderHook(() => useIncidentDetail('inc-9'), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.incident.id).toBe('inc-9');
    expect(result.current.data?.incident.version).toBe(3);
    // O ETag é o que alimenta o `If-Match` da próxima escrita.
    expect(result.current.data?.etag).toBe('"3"');
  });
});
