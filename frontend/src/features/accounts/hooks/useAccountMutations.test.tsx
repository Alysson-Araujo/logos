import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useToastStore } from '@/hooks/useToast';
import { isApiError } from '@/lib/http';
import { createQueryClient } from '@/lib/queryClient';
import { createAccountFixtures } from '@/test/factories';
import { server } from '@/test/setup';

import type { AccountSummary, CreateAccountInput } from '../types';
import { accountQueryKeys } from './useAccounts';
import { useCreateAccount, useResendInvite, useSetAccountActive } from './useAccountMutations';

/**
 * Mutações da administração de contas: convidar, reenviar convite e
 * ativar/desativar.
 *
 * O que este teste protege: as três operações têm efeito externo (e-mail, perda
 * de acesso) e por isso **não** podem ser otimistas. O estado que interessa
 * — convite pendente, situação, último acesso — é do servidor, e pintá-lo antes
 * da resposta seria mentira por um instante: a pessoa veria "Convite enviado"
 * para um e-mail que a API recusou por já existir. Aqui se verifica que a lista
 * não muda antes da resposta, que ela é invalidada depois de qualquer desfecho
 * (inclusive falha) e que a mensagem que aparece na tela vem do código da API, e
 * não do texto cru do servidor.
 */

const CONTAS = createAccountFixtures();
const JOANA = CONTAS[1];

if (JOANA === undefined) throw new Error('as fábricas de conta mudaram de forma');

const NOVA_CONTA: CreateAccountInput = {
  email: 'novo.analista@parceiro.com.br',
  role: 'ANALYST',
};

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

/** Cliente com a lista já carregada: é o estado que a tela de administração tem. */
function createSeededClient(): QueryClient {
  const client = createQueryClient();
  client.setQueryData(accountQueryKeys.list(), CONTAS);
  return client;
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('useCreateAccount', () => {
  it('manda só e-mail e papel — o nome e a senha não passam por aqui', async () => {
    const corpos: unknown[] = [];
    server.use(
      http.post('*/users', async ({ request }) => {
        corpos.push(await request.json());
        return HttpResponse.json(
          {
            id: 'conta-nova',
            email: NOVA_CONTA.email,
            role: NOVA_CONTA.role,
            inviteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await result.current.mutateAsync(NOVA_CONTA);
    });

    // A senha temporária sai por e-mail: mandá-la (ou um nome inventado) aqui
    // seria dado a mais no corpo e um campo a mais para o servidor ignorar.
    expect(corpos).toEqual([{ email: 'novo.analista@parceiro.com.br', role: 'ANALYST' }]);
    await waitFor(() => {
      expect(result.current.data?.id).toBe('conta-nova');
    });
    expect(result.current.data?.inviteExpiresAt).toEqual(expect.any(String));
  });

  it('invalida a lista de contas depois do convite', async () => {
    server.use(
      http.post('*/users', () =>
        HttpResponse.json(
          {
            id: 'conta-nova',
            email: NOVA_CONTA.email,
            role: 'ANALYST',
            inviteExpiresAt: '2026-01-01T00:00:00.000Z',
          },
          { status: 201 },
        ),
      ),
    );
    const client = createSeededClient();
    const { result } = renderHook(() => useCreateAccount(), { wrapper: createWrapper(client) });

    await act(async () => {
      await result.current.mutateAsync(NOVA_CONTA);
    });

    // A conta nova nasce com convite pendente: só o servidor sabe disso.
    expect(client.getQueryState(accountQueryKeys.list())?.isInvalidated).toBe(true);
  });

  it('o e-mail repetido sobe tipado, para a tela marcar o campo certo', async () => {
    server.use(
      http.post('*/users', () =>
        apiErrorResponse(409, 'EMAIL_ALREADY_EXISTS', 'Já existe uma conta com este e-mail.', {
          email: NOVA_CONTA.email,
        }),
      ),
    );

    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(createSeededClient()),
    });

    let capturado: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(NOVA_CONTA);
      } catch (error) {
        capturado = error;
      }
    });

    if (!isApiError(capturado)) throw new Error('esperava um ApiError da API');
    expect(capturado.status).toBe(409);
    expect(capturado.code).toBe('EMAIL_ALREADY_EXISTS');
    // Sem toast: o formulário mostra a mensagem no campo de e-mail, que é onde a
    // pessoa pode corrigir.
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});

describe('useResendInvite', () => {
  it('reenvia pelo id da conta e avisa que a senha anterior deixou de valer', async () => {
    const caminhos: string[] = [];
    server.use(
      http.post('*/users/:id/invite', ({ params }) => {
        caminhos.push(String(params.id));
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { result } = renderHook(() => useResendInvite(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await result.current.mutateAsync(JOANA);
    });

    expect(caminhos).toEqual([JOANA.id]);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'success',
        title: 'Convite reenviado',
        // A senha anterior morre no reenvio: sem dizer isso, a pessoa tentaria
        // entrar com a que recebeu antes.
        description: `${JOANA.email} · a senha temporária anterior deixou de valer`,
        durationMs: 4000,
      }),
    ]);
  });

  it('numa falha, invalida a lista do mesmo jeito', async () => {
    server.use(
      http.post('*/users/:id/invite', () =>
        apiErrorResponse(500, 'INTERNAL_ERROR', 'A API falhou ao enviar o e-mail.'),
      ),
    );
    const client = createSeededClient();
    const { result } = renderHook(() => useResendInvite(), { wrapper: createWrapper(client) });

    await act(async () => {
      await expect(result.current.mutateAsync(JOANA)).rejects.toThrow();
    });

    // O reenvio pode ter chegado ao servidor antes de a resposta falhar.
    expect(client.getQueryState(accountQueryKeys.list())?.isInvalidated).toBe(true);
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'error',
        title: 'Não foi possível reenviar o convite',
        description: 'A API falhou ao concluir a operação. Tente de novo.',
      }),
    ]);
  });
});

describe('useSetAccountActive', () => {
  it('manda só a situação no PATCH e não muda a lista antes da resposta', async () => {
    const client = createSeededClient();
    const corpos: unknown[] = [];
    let situacaoNaListaDuranteARequisicao: boolean | undefined;

    server.use(
      http.patch('*/users/:id', async ({ request }) => {
        corpos.push(await request.json());
        // Instante da requisição: a lista ainda tem que estar como estava.
        situacaoNaListaDuranteARequisicao = client.getQueryData<AccountSummary[]>(
          accountQueryKeys.list(),
        )?.[1]?.isActive;
        await delay(30);
        return HttpResponse.json({ ...JOANA, isActive: true, invitePending: false });
      }),
    );

    const { result } = renderHook(() => useSetAccountActive(), { wrapper: createWrapper(client) });

    await act(async () => {
      await result.current.mutateAsync({ account: JOANA, isActive: true });
    });

    expect(corpos).toEqual([{ isActive: true }]);
    expect(situacaoNaListaDuranteARequisicao).toBe(false);
    expect(client.getQueryState(accountQueryKeys.list())?.isInvalidated).toBe(true);
  });

  it('avisa "Conta reativada" quando o servidor confirma a ativação', async () => {
    server.use(
      http.patch('*/users/:id', () =>
        HttpResponse.json({ ...JOANA, isActive: true, invitePending: false }),
      ),
    );

    const { result } = renderHook(() => useSetAccountActive(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await result.current.mutateAsync({ account: JOANA, isActive: true });
    });

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'success',
        title: 'Conta reativada',
        description: JOANA.email,
      }),
    ]);
  });

  it('avisa "Conta desativada" quando o servidor confirma a desativação', async () => {
    server.use(http.patch('*/users/:id', () => HttpResponse.json({ ...JOANA, isActive: false })));

    const { result } = renderHook(() => useSetAccountActive(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await result.current.mutateAsync({ account: JOANA, isActive: false });
    });

    // O texto vem do que o SERVIDOR confirmou, não do que foi pedido: se a
    // resposta divergir, quem manda é ela.
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ variant: 'success', title: 'Conta desativada' }),
    ]);
  });

  it('o erro de domínio vira a mensagem em pt-BR do código da API', async () => {
    server.use(
      http.patch('*/users/:id', () =>
        apiErrorResponse(409, 'CANNOT_DEACTIVATE_SELF', 'Você não pode desativar a própria conta.'),
      ),
    );

    const { result } = renderHook(() => useSetAccountActive(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ account: JOANA, isActive: false }),
      ).rejects.toThrow();
    });

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        variant: 'error',
        title: 'Não foi possível mudar a situação da conta',
        description: 'Você não pode desativar a própria conta.',
      }),
    ]);
  });

  it('numa falha, a lista continua sendo invalidada', async () => {
    const client = createSeededClient();
    server.use(
      http.patch('*/users/:id', () =>
        apiErrorResponse(500, 'INTERNAL_ERROR', 'A API falhou ao salvar.'),
      ),
    );

    const { result } = renderHook(() => useSetAccountActive(), { wrapper: createWrapper(client) });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ account: JOANA, isActive: true }),
      ).rejects.toThrow();
    });

    expect(client.getQueryState(accountQueryKeys.list())?.isInvalidated).toBe(true);
    expect(client.getQueryData<AccountSummary[]>(accountQueryKeys.list())?.[1]?.isActive).toBe(
      false,
    );
  });
});
