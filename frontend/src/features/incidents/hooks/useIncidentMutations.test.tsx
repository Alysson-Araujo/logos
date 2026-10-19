import { QueryClientProvider, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useToastStore } from '@/hooks/useToast';
import { createQueryClient } from '@/lib/queryClient';
import { createIncidentFixture } from '@/test/factories';
import { server } from '@/test/setup';

import type { IncidentDetailResult } from '../api/endpoints';
import {
  DEFAULT_INCIDENT_FILTERS,
  type Incident,
  type IncidentListResponse,
  type IncidentStatus,
} from '../types';
import { useIncidentUiStore } from './useIncidentUiStore';
import { useChangeIncidentStatus, type ChangeStatusVariables } from './useIncidentMutations';
import { incidentQueryKeys } from './useIncidents';

/**
 * Transição de status: atualização otimista, desfazer e conflito de versão.
 *
 * O que este teste protege: o analista precisa ver a mudança na hora — esperar o
 * `200` para pintar a linha faz a interface parecer travada —, mas nunca pode
 * ficar com uma mudança que o servidor recusou. É o par otimista/desfazer que
 * garante isso, e é aqui que ele é exercitado: o patch tem que estar no cache
 * **no instante em que a requisição chega**, o desfazer tem que devolver fila e
 * detalhe ao estado exato de antes, e o `409` (dois analistas no mesmo caso) tem
 * que abrir o modal de conflito em vez de um aviso genérico. Testar isso por
 * componente esconderia o momento exato do patch; por isso o teste lê o cache.
 */

const INCIDENTE = createIncidentFixture({
  id: 'inc-3f2a',
  code: 'INC-2026-000123',
  status: 'ABERTO',
  version: 3,
  resolutionNotes: null,
});

const DETALHE_ANTERIOR: IncidentDetailResult = { incident: INCIDENTE, etag: '"3"' };

const LISTA_ANTERIOR: InfiniteData<IncidentListResponse, string | null> = {
  pages: [
    {
      items: [INCIDENTE],
      pageInfo: { nextCursor: null, hasNextPage: false, limit: 50 },
      meta: { total: 1, appliedFilters: {} },
    },
  ],
  pageParams: [null],
};

const CHAVE_DA_FILA = incidentQueryKeys.list(DEFAULT_INCIDENT_FILTERS);
const CHAVE_DO_KPI = incidentQueryKeys.counter('ABERTO');

interface StatusCall {
  id: string;
  ifMatch: string | null;
  idempotencyKey: string | null;
  body: unknown;
}

const chamadas: StatusCall[] = [];

/** Instala o `POST /incidents/:id/status` registrando o que saiu na requisição. */
function serveStatusChange(
  responder: () => Response | Promise<Response> = () =>
    HttpResponse.json({ ...INCIDENTE, status: 'EM_INVESTIGACAO', version: 4 }),
): void {
  server.use(
    http.post('*/incidents/:id/status', async ({ request, params }) => {
      const body: unknown = await request.json();
      chamadas.push({
        id: String(params.id),
        ifMatch: request.headers.get('If-Match'),
        idempotencyKey: request.headers.get('Idempotency-Key'),
        body,
      });
      return responder();
    }),
  );
}

function apiErrorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return HttpResponse.json(
    {
      error: {
        code,
        message,
        details: details ?? null,
        requestId: `req-${String(status)}`,
        timestamp: new Date().toISOString(),
      },
    },
    { status },
  );
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Cliente com a fila e o detalhe já carregados: é o estado que a tela teria. */
function createSeededClient(): QueryClient {
  const client = createQueryClient();
  client.setQueryData(incidentQueryKeys.detail(INCIDENTE.id), DETALHE_ANTERIOR);
  client.setQueryData(CHAVE_DA_FILA, LISTA_ANTERIOR);
  client.setQueryData(CHAVE_DO_KPI, 7);
  return client;
}

function detalheNoCache(client: QueryClient): IncidentDetailResult | undefined {
  return client.getQueryData<IncidentDetailResult>(incidentQueryKeys.detail(INCIDENTE.id));
}

function statusNaFila(client: QueryClient): IncidentStatus | undefined {
  const fila =
    client.getQueryData<InfiniteData<IncidentListResponse, string | null>>(CHAVE_DA_FILA);
  return fila?.pages[0]?.items[0]?.status;
}

function variaveisDe(status: IncidentStatus = 'EM_INVESTIGACAO'): ChangeStatusVariables {
  return {
    id: INCIDENTE.id,
    status,
    version: INCIDENTE.version,
    scope: `${INCIDENTE.id}:${status}`,
  };
}

beforeEach(() => {
  chamadas.length = 0;
  useToastStore.setState({ toasts: [] });
  useIncidentUiStore.setState({ recentlyUpdatedId: null, conflict: null });
});

afterEach(() => {
  // `markUpdated` deixa um timer de 1,4 s armado: sem cancelar, ele escreveria no
  // store depois do fim do teste.
  useIncidentUiStore.getState().clearUpdated();
});

describe('useChangeIncidentStatus — atualização otimista', () => {
  it('a fila e o detalhe já mostram o novo status quando a requisição chega', async () => {
    const client = createSeededClient();
    let statusNoDetalhe: IncidentStatus | undefined;
    let statusNaLista: IncidentStatus | undefined;
    let versaoNoDetalhe: number | undefined;

    serveStatusChange(() => {
      // Este é o instante que importa: nada foi confirmado ainda e a tela já
      // precisa estar pintada com a mudança.
      statusNoDetalhe = detalheNoCache(client)?.incident.status;
      statusNaLista = statusNaFila(client);
      versaoNoDetalhe = detalheNoCache(client)?.incident.version;
      return HttpResponse.json({ ...INCIDENTE, status: 'EM_INVESTIGACAO', version: 4 });
    });

    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync(variaveisDe());
    });

    expect(statusNoDetalhe).toBe('EM_INVESTIGACAO');
    expect(statusNaLista).toBe('EM_INVESTIGACAO');
    // O lock otimista já assume a versão seguinte: o botão de novo status só
    // reabre com a versão que a resposta vai confirmar.
    expect(versaoNoDetalhe).toBe(4);
  });

  it('aplica a justificativa aparada junto do novo status', async () => {
    const client = createSeededClient();
    let notasNoDetalhe: string | null | undefined;

    serveStatusChange(() => {
      notasNoDetalhe = detalheNoCache(client)?.incident.resolutionNotes;
      return HttpResponse.json({
        ...INCIDENTE,
        status: 'FECHADO',
        resolutionNotes: 'Encerrado após perícia',
        version: 4,
      });
    });

    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        ...variaveisDe('FECHADO'),
        resolutionNotes: '  Encerrado após perícia  ',
      });
    });

    expect(notasNoDetalhe).toBe('Encerrado após perícia');
  });

  it('ao confirmar, avisa no canto e destaca a linha atualizada', async () => {
    const client = createSeededClient();
    serveStatusChange();

    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync(variaveisDe());
    });

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'success',
        title: 'Status atualizado para Em Investigação',
        description: 'INC-2026-000123',
      }),
    ]);
    expect(useIncidentUiStore.getState().recentlyUpdatedId).toBe(INCIDENTE.id);
  });
});

describe('useChangeIncidentStatus — desfazer', () => {
  it('em falha do servidor, a fila e o detalhe voltam ao estado exato de antes', async () => {
    const client = createSeededClient();
    let statusDuranteARequisicao: IncidentStatus | undefined;
    serveStatusChange(() => {
      // O patch otimista já está no cache quando a requisição sai; é este o
      // estado que o desfazer tem que desmontar.
      statusDuranteARequisicao = detalheNoCache(client)?.incident.status;
      return apiErrorResponse(500, 'INTERNAL_ERROR', 'A API falhou ao concluir a operação.');
    });

    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(variaveisDe())).rejects.toThrow();
    });

    expect(statusDuranteARequisicao).toBe('EM_INVESTIGACAO');
    // A promessa otimista não pode sobreviver a um servidor que disse não: a
    // linha voltaria a "Em investigação" a cada 30 s de cache.
    expect(detalheNoCache(client)).toEqual(DETALHE_ANTERIOR);
    expect(statusNaFila(client)).toBe('ABERTO');
  });

  it('avisa no canto por que o status não mudou', async () => {
    const client = createSeededClient();
    serveStatusChange(() =>
      apiErrorResponse(500, 'INTERNAL_ERROR', 'A API falhou ao concluir a operação.'),
    );

    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(variaveisDe())).rejects.toThrow();
    });

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'error',
        title: 'Não foi possível mudar o status',
        description: 'A API falhou ao concluir a operação.',
        durationMs: 5000,
      }),
    ]);
  });

  it('não destaca a linha nem abre o modal de conflito numa falha comum', async () => {
    const client = createSeededClient();
    serveStatusChange(() =>
      apiErrorResponse(422, 'INVALID_STATUS_TRANSITION', 'Transição inválida.'),
    );

    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(variaveisDe())).rejects.toThrow();
    });

    expect(useIncidentUiStore.getState().recentlyUpdatedId).toBeNull();
    expect(useIncidentUiStore.getState().conflict).toBeNull();
  });
});

describe('useChangeIncidentStatus — conflito de versão', () => {
  const CONFLITO = {
    ...INCIDENTE,
    status: 'FECHADO' as const,
    resolutionNotes: 'Outro analista encerrou o caso.',
    version: 5,
  };

  it('em 409, abre o modal de conflito com o estado atual do servidor', async () => {
    const client = createSeededClient();
    serveStatusChange(() =>
      apiErrorResponse(
        409,
        'VERSION_CONFLICT',
        'O incidente foi alterado por outro analista (versão atual 5).',
        { current: CONFLITO },
      ),
    );

    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          ...variaveisDe('FECHADO'),
          resolutionNotes: 'Encerrado por mim',
        }),
      ).rejects.toThrow();
    });

    const conflito = useIncidentUiStore.getState().conflict;
    // O modal precisa das duas metades para montar o diff: o que o analista
    // tentou salvar e o que o servidor tem agora.
    expect(conflito?.server).toEqual(CONFLITO);
    expect(conflito?.attempted.status).toBe('FECHADO');
    expect(conflito?.attempted.resolutionNotes).toBe('Encerrado por mim');
    expect(conflito?.attempted.viewedVersion).toBe(3);
    expect(conflito?.attempted.attemptedAt).toEqual(expect.any(String));
    expect(conflito?.requestId).toBe('req-409');
    expect(conflito?.message).toContain('alterado por outro analista');
  });

  it('o conflito também desfaz o que foi pintado antes da resposta', async () => {
    const client = createSeededClient();
    serveStatusChange(() =>
      apiErrorResponse(409, 'VERSION_CONFLICT', 'O incidente foi alterado.', { current: CONFLITO }),
    );

    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(variaveisDe())).rejects.toThrow();
    });

    expect(detalheNoCache(client)).toEqual(DETALHE_ANTERIOR);
    expect(statusNaFila(client)).toBe('ABERTO');
  });

  it('em 409, não cobre o modal com o aviso genérico de erro', async () => {
    const client = createSeededClient();
    serveStatusChange(() =>
      apiErrorResponse(409, 'VERSION_CONFLICT', 'O incidente foi alterado.', { current: CONFLITO }),
    );

    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(variaveisDe())).rejects.toThrow();
    });

    // Duas mensagens para o mesmo fato: o modal já explica o conflito.
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('em 409 sem o estado do servidor no corpo, avisa em vez de sair calado', async () => {
    const client = createSeededClient();
    serveStatusChange(() =>
      apiErrorResponse(409, 'VERSION_CONFLICT', 'O incidente foi alterado.', {
        current: { id: 'sem-os-campos-do-contrato' },
      }),
    );

    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(variaveisDe())).rejects.toThrow();
    });

    // Sem o incidente do servidor não há diff para montar: abrir um modal vazio
    // seria pior que dizer que a mudança não passou.
    expect(useIncidentUiStore.getState().conflict).toBeNull();

    // **Este era o defeito.** O `return` do bloco de conflito rodava mesmo
    // quando `readConflictServerState` devolvia `null`, então o handler saía em
    // silêncio: a mutação otimista era desfeita, a linha voltava ao status
    // anterior e **nada explicava por quê**. Quem usa clica de novo — e é assim
    // que se duplica uma decisão.
    //
    // Acontece quando o `details.current` do 409 não passa no `incidentSchema`:
    // proxy reescrevendo o corpo, versão de API divergente ou qualquer desvio do
    // contrato. O caminho de conflito ficava refém do parse da resposta.
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'error',
        title: 'O caso mudou enquanto você decidia',
      }),
    ]);
  });
});

describe('useChangeIncidentStatus — contrato da requisição', () => {
  it('manda a versão vista na tela em If-Match', async () => {
    serveStatusChange();
    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await result.current.mutateAsync(variaveisDe());
    });

    // É este header que faz o lock otimista funcionar: sem ele, dois analistas
    // sobrescreveriam um ao outro sem ninguém perceber.
    expect(chamadas[0]?.ifMatch).toBe('"3"');
    expect(chamadas[0]?.id).toBe(INCIDENTE.id);
  });

  it('leva a justificativa aparada no corpo', async () => {
    serveStatusChange(() => HttpResponse.json({ ...INCIDENTE, status: 'FECHADO', version: 4 }));
    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await result.current.mutateAsync({
        ...variaveisDe('FECHADO'),
        resolutionNotes: '  Encerrado após perícia  ',
      });
    });

    expect(chamadas[0]?.body).toEqual({
      status: 'FECHADO',
      resolutionNotes: 'Encerrado após perícia',
    });
  });

  it('omite a justificativa quando ela é só espaço', async () => {
    serveStatusChange();
    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await result.current.mutateAsync({ ...variaveisDe(), resolutionNotes: '   ' });
    });

    expect(chamadas[0]?.body).toEqual({ status: 'EM_INVESTIGACAO' });
  });

  it('reaproveita a Idempotency-Key enquanto a tentativa não conclui', async () => {
    let tentativas = 0;
    serveStatusChange(() => {
      tentativas += 1;
      if (tentativas === 1) {
        return apiErrorResponse(500, 'INTERNAL_ERROR', 'A API falhou.');
      }
      return HttpResponse.json({ ...INCIDENTE, status: 'EM_INVESTIGACAO', version: 4 });
    });
    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(variaveisDe())).rejects.toThrow();
    });
    await act(async () => {
      await result.current.mutateAsync(variaveisDe());
    });

    // "Tentar de novo" é a MESMA tentativa: com chave nova, um servidor que já
    // gravou o primeiro envio aplicaria a mudança duas vezes.
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]?.idempotencyKey).toBe(chamadas[0]?.idempotencyKey);
  });

  it('descarta a chave quando a tentativa conclui', async () => {
    serveStatusChange();
    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await result.current.mutateAsync(variaveisDe());
    });
    await act(async () => {
      await result.current.mutateAsync(variaveisDe());
    });

    // Concluída a tentativa, o próximo clique é uma mudança nova — e precisa de
    // chave nova, senão o servidor trataria a segunda como reenvio da primeira.
    expect(chamadas[1]?.idempotencyKey).not.toBe(chamadas[0]?.idempotencyKey);
  });

  it('escopos diferentes nunca compartilham chave', async () => {
    serveStatusChange();
    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await result.current.mutateAsync(variaveisDe('EM_INVESTIGACAO'));
    });
    await act(async () => {
      await result.current.mutateAsync(variaveisDe('FECHADO'));
    });

    expect(chamadas[1]?.idempotencyKey).not.toBe(chamadas[0]?.idempotencyKey);
  });
});

describe('useChangeIncidentStatus — cache depois do desfecho', () => {
  it('invalida detalhe, fila e KPIs quando a mudança passa', async () => {
    const client = createSeededClient();
    serveStatusChange();
    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync(variaveisDe());
    });

    expect(client.getQueryState(incidentQueryKeys.detail(INCIDENTE.id))?.isInvalidated).toBe(true);
    expect(client.getQueryState(CHAVE_DA_FILA)?.isInvalidated).toBe(true);
    expect(client.getQueryState(CHAVE_DO_KPI)?.isInvalidated).toBe(true);
  });

  it('invalida do mesmo jeito quando a mudança falha', async () => {
    const client = createSeededClient();
    serveStatusChange(() => apiErrorResponse(500, 'INTERNAL_ERROR', 'A API falhou.'));
    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(variaveisDe())).rejects.toThrow();
    });

    // O 500 pode ter escondido uma escrita que chegou ao banco: o cache não pode
    // continuar "fresco" depois de uma falha.
    expect(client.getQueryState(CHAVE_DA_FILA)?.isInvalidated).toBe(true);
    expect(client.getQueryState(CHAVE_DO_KPI)?.isInvalidated).toBe(true);
  });

  it('respeita uma resposta lenta sem perder o rollback', async () => {
    const client = createSeededClient();
    serveStatusChange(async () => {
      await delay(60);
      return apiErrorResponse(500, 'INTERNAL_ERROR', 'A API falhou devagar.');
    });

    const { result } = renderHook(() => useChangeIncidentStatus(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await expect(result.current.mutateAsync(variaveisDe())).rejects.toThrow();
    });

    const restaurado: Incident = DETALHE_ANTERIOR.incident;
    expect(detalheNoCache(client)?.incident).toEqual(restaurado);
  });
});
