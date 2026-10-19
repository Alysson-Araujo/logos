import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useToastStore } from '@/hooks/useToast';
import { isApiError } from '@/lib/http';
import { createQueryClient } from '@/lib/queryClient';
import { createIncidentFixture } from '@/test/factories';
import { server } from '@/test/setup';

import { readIncidentFieldErrors } from '../api/endpoints';
import { DEFAULT_INCIDENT_FILTERS, type NewIncidentInput } from '../types';
import { incidentQueryKeys } from './useIncidents';
import { useCreateIncident } from './useCreateIncident';

/**
 * Cadastro de incidente (`POST /incidents`).
 *
 * O que este teste protege: o registro não pode se perder nem se duplicar. Um
 * clique duplo, um reenvio depois de um timeout ou uma resposta que chegou mas o
 * servidor já gravou — todas essas situações dependem de duas coisas que só
 * existem aqui: a `Idempotency-Key` que acompanha o corpo e a invalidação do
 * cache em `onSettled`, que acontece **inclusive quando o envio falha**. Sem a
 * segunda, a fila continuaria mostrando o estado anterior ao cadastro enquanto o
 * servidor já tem o caso novo.
 */

const ENTRADA: NewIncidentInput = {
  title: '  Colisão traseira sem feridos  ',
  category: 'ACIDENTE_COM_VEICULO',
  criticality: 'MEDIA',
  reportedBy: '  Rádio Frota 12  ',
  description: '   ',
  truckPlate: ' QRD1A23 ',
};

const CRIADO = createIncidentFixture({
  id: 'inc-novo',
  code: 'INC-2026-000124',
  category: 'ACIDENTE_COM_VEICULO',
  criticality: 'MEDIA',
  title: 'Colisão traseira sem feridos',
});

interface CreateCall {
  body: unknown;
  idempotencyKey: string | null;
}

const chamadas: CreateCall[] = [];

function serveCreate(
  responder: () => Response = () => HttpResponse.json(CRIADO, { status: 201 }),
): void {
  server.use(
    http.post('*/incidents', async ({ request }) => {
      const body: unknown = await request.json();
      chamadas.push({ body, idempotencyKey: request.headers.get('Idempotency-Key') });
      return responder();
    }),
  );
}

function validationError(): Response {
  return HttpResponse.json(
    {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'A requisição contém dados inválidos.',
        details: {
          issues: [{ path: ['title'], message: 'O título deve ter ao menos 8 caracteres.' }],
        },
        requestId: 'req-422',
        timestamp: new Date().toISOString(),
      },
    },
    { status: 422 },
  );
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  chamadas.length = 0;
  useToastStore.setState({ toasts: [] });
});

describe('useCreateIncident — envio', () => {
  it('manda o formulário no corpo do contrato, com os opcionais vazios fora', async () => {
    serveCreate();
    const { result } = renderHook(() => useCreateIncident(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await act(async () => {
      await result.current.mutateAsync(ENTRADA);
    });

    // `description` só tinha espaços: virar `""` gravaria um campo preenchido com
    // nada, e a tela mostraria uma descrição em branco que ninguém escreveu.
    expect(chamadas[0]?.body).toEqual({
      title: 'Colisão traseira sem feridos',
      category: 'ACIDENTE_COM_VEICULO',
      criticality: 'MEDIA',
      reportedBy: 'Rádio Frota 12',
      truckPlate: 'QRD1A23',
    });
  });

  it('leva uma Idempotency-Key em cada envio', async () => {
    serveCreate();
    const { result } = renderHook(() => useCreateIncident(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await act(async () => {
      await result.current.mutateAsync(ENTRADA);
    });

    // Um timeout no meio do caminho não pode abrir dois casos: é a chave que
    // permite ao servidor reconhecer o reenvio.
    expect(chamadas[0]?.idempotencyKey).toBeTruthy();
  });

  it('dois cliques são dois registros distintos, não o mesmo reenviado', async () => {
    serveCreate();
    const { result } = renderHook(() => useCreateIncident(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await act(async () => {
      await result.current.mutateAsync(ENTRADA);
    });
    await act(async () => {
      await result.current.mutateAsync(ENTRADA);
    });

    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]?.idempotencyKey).not.toBe(chamadas[0]?.idempotencyKey);
  });

  it('não repete o envio quando a API recusa os dados', async () => {
    let tentativas = 0;
    serveCreate(() => {
      tentativas += 1;
      return validationError();
    });
    const { result } = renderHook(() => useCreateIncident(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(ENTRADA)).rejects.toThrow();
    });

    // Repetir um 422 só gastaria o teto de escrita da API: o corpo não vai mudar.
    expect(tentativas).toBe(1);
  });

  it('devolve o erro tipado, com o campo que a API apontou', async () => {
    serveCreate(validationError);
    const { result } = renderHook(() => useCreateIncident(), {
      wrapper: createWrapper(createQueryClient()),
    });

    let capturado: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(ENTRADA);
      } catch (error) {
        capturado = error;
      }
    });

    if (!isApiError(capturado)) throw new Error('esperava um ApiError da API');
    expect(capturado.status).toBe(422);
    expect(readIncidentFieldErrors(capturado)).toEqual([
      { field: 'title', message: 'O título deve ter ao menos 8 caracteres.' },
    ]);
  });
});

describe('useCreateIncident — aviso e cache', () => {
  it('avisa no canto qual caso entrou e com que criticidade', async () => {
    serveCreate();
    const { result } = renderHook(() => useCreateIncident(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await act(async () => {
      await result.current.mutateAsync(ENTRADA);
    });

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'success',
        title: 'Incidente registrado',
        description: 'INC-2026-000124 entrou na fila como Média.',
      }),
    ]);
  });

  it('não avisa nada quando o envio falha', async () => {
    serveCreate(validationError);
    const { result } = renderHook(() => useCreateIncident(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(ENTRADA)).rejects.toThrow();
    });

    // Quem escreve a mensagem do formulário é a tela, campo a campo; um toast
    // genérico aqui só repetiria a informação pior.
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('invalida a fila e os KPIs depois de registrar', async () => {
    serveCreate();
    const client = createQueryClient();
    const chaveDaFila = incidentQueryKeys.list(DEFAULT_INCIDENT_FILTERS);
    const chaveDoKpi = incidentQueryKeys.counter('ABERTO');
    client.setQueryData(chaveDaFila, {
      pages: [
        {
          items: [],
          pageInfo: { nextCursor: null, hasNextPage: false, limit: 50 },
          meta: { total: 0 },
        },
      ],
      pageParams: [null],
    });
    client.setQueryData(chaveDoKpi, 7);
    const { result } = renderHook(() => useCreateIncident(), { wrapper: createWrapper(client) });

    await act(async () => {
      await result.current.mutateAsync(ENTRADA);
    });

    expect(client.getQueryState(chaveDaFila)?.isInvalidated).toBe(true);
    expect(client.getQueryState(chaveDoKpi)?.isInvalidated).toBe(true);
  });

  it('invalida o cache mesmo quando o envio falha depois de o servidor gravar', async () => {
    serveCreate(
      () =>
        new HttpResponse(null, {
          status: 500,
        }),
    );
    const client = createQueryClient();
    const chaveDaFila = incidentQueryKeys.list(DEFAULT_INCIDENT_FILTERS);
    const chaveDoKpi = incidentQueryKeys.counter('ABERTO');
    client.setQueryData(chaveDaFila, {
      pages: [
        {
          items: [],
          pageInfo: { nextCursor: null, hasNextPage: false, limit: 50 },
          meta: { total: 0 },
        },
      ],
      pageParams: [null],
    });
    client.setQueryData(chaveDoKpi, 7);
    const { result } = renderHook(() => useCreateIncident(), { wrapper: createWrapper(client) });

    await act(async () => {
      await expect(result.current.mutateAsync(ENTRADA)).rejects.toThrow();
    });

    // O caso pode ter sido gravado antes da falha de resposta: deixar o cache
    // "fresco" faria a fila mentir por 30 s, exatamente sobre um registro novo.
    expect(client.getQueryState(chaveDaFila)?.isInvalidated).toBe(true);
    expect(client.getQueryState(chaveDoKpi)?.isInvalidated).toBe(true);
  });
});
