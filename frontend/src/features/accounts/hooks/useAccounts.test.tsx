import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createQueryClient } from '@/lib/queryClient';
import { createAccountFixtures } from '@/test/factories';
import { server } from '@/test/setup';

import type { AccountSummary } from '../types';
import { accountQueryKeys, useAccounts } from './useAccounts';

/**
 * Listagem de contas de acesso (`GET /users`).
 *
 * O que este teste protege: a tela de administração é a única que enxerga todas
 * as contas, e ela depende de três coisas. A lista chegar inteira, sem paginação
 * escondida — o servidor devolve tudo e o filtro é em memória; um erro de
 * permissão **não** ser repetido, porque insistir num `403` não muda o papel de
 * ninguém e ainda gasta a cota; e a chave de cache ser única, para que a tela não
 * guarde duas cópias da mesma lista que podem divergir depois de um convite.
 */

const chamadas: string[] = [];

function serveAccounts(accounts: readonly AccountSummary[] = createAccountFixtures()): void {
  server.use(
    http.get('*/users', ({ request }) => {
      chamadas.push(new URL(request.url).pathname);
      return HttpResponse.json(accounts);
    }),
  );
}

function forbidden(): Response {
  return HttpResponse.json(
    {
      error: {
        code: 'INSUFFICIENT_ROLE',
        message: 'Seu perfil não tem permissão para esta ação.',
        details: { requiredRole: 'ADMIN' },
        requestId: 'req-403',
        timestamp: new Date().toISOString(),
      },
    },
    { status: 403 },
  );
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  chamadas.length = 0;
});

describe('useAccounts', () => {
  it('lista as contas que a API devolve, com os três estados', async () => {
    serveAccounts();
    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toHaveLength(4);
    expect(result.current.data?.map((account) => account.email)).toEqual([
      'ana@demo.example.com',
      'joana.prado@demo.example.com',
      'bruno.tavares@demo.example.com',
      'carla.mendes@demo.example.com',
    ]);
    // Convite pendente e desativado são situações diferentes e chegam separadas.
    expect(result.current.data?.[1]).toMatchObject({ invitePending: true, isActive: false });
    expect(result.current.data?.[3]).toMatchObject({ invitePending: false, isActive: false });
  });

  it('lista vazia é lista vazia, e não erro', async () => {
    serveAccounts([]);
    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // A tela distingue "nenhuma conta cadastrada" de "não foi possível carregar";
    // devolver `undefined` aqui apagaria essa diferença.
    expect(result.current.data).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('sem permissão, devolve o erro e não fica repetindo a consulta', async () => {
    server.use(
      http.get('*/users', () => {
        chamadas.push('GET /users');
        return forbidden();
      }),
    );
    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(createQueryClient()),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toMatchObject({ status: 403, code: 'INSUFFICIENT_ROLE' });

    // O cliente HTTP repetiria 5xx em 1s/2s/4s; um 403 não pode gerar nenhuma
    // tentativa nova — o papel não muda por insistir.
    await new Promise((resolve) => {
      setTimeout(resolve, 1200);
    });
    expect(chamadas).toHaveLength(1);
  });

  it('a chave de cache é única e não depende de parâmetro', () => {
    expect(accountQueryKeys.list()).toEqual(['accounts', 'list']);
    expect(accountQueryKeys.list()).toEqual(accountQueryKeys.list());
  });

  it('duas telas montadas ao mesmo tempo compartilham uma consulta só', async () => {
    serveAccounts();
    const client = createQueryClient();

    const primeira = renderHook(() => useAccounts(), { wrapper: createWrapper(client) });
    await waitFor(() => {
      expect(primeira.result.current.isSuccess).toBe(true);
    });

    const segunda = renderHook(() => useAccounts(), { wrapper: createWrapper(client) });
    await waitFor(() => {
      expect(segunda.result.current.isSuccess).toBe(true);
    });

    // Uma segunda entrada para a mesma lista faria a tela mostrar contas
    // desatualizadas logo depois de um convite.
    expect(chamadas).toHaveLength(1);
    expect(segunda.result.current.data).toEqual(primeira.result.current.data);
  });
});
