import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { isApiError } from '@/lib/http';
import { createQueryClient } from '@/lib/queryClient';
import { server } from '@/test/setup';

import { incidentQueryKeys } from '@/features/incidents/hooks/useIncidents';
import { DEFAULT_INCIDENT_FILTERS } from '@/features/incidents/types';

import { describeChangePasswordError, describePasswordChangeError } from '../labels';
import type { ChangePasswordPayload } from '../types';
import { useAuthStore } from '../useAuthStore';
import { useChangePassword } from './useChangePassword';

/**
 * Troca de senha, nos dois fluxos que compartilham o mesmo hook: a troca
 * voluntária do menu e o primeiro acesso do convite.
 *
 * O que este teste protege: a sessão de quem acabou de definir a senha. Duas
 * decisões aqui não são óbvias e quebrariam a aplicação em silêncio:
 *
 *  - um `401` nesta chamada significa **"a senha atual está errada"**, e não
 *    "sessão perdida". Se ele derrubasse a sessão, um erro de digitação expulsaria
 *    a pessoa para o login;
 *  - o cache é limpo **apenas** quando a troca era obrigatória. As respostas
 *    anteriores vieram de uma sessão que ainda não podia usar a API (eram
 *    `403 PASSWORD_CHANGE_REQUIRED`); reaproveitá-las mostraria erro de permissão
 *    na triagem recém-liberada. Na troca voluntária, limpar seria jogar fora todo
 *    o trabalho carregado sem motivo.
 */

const SENHA_ATUAL = 'temporaria-123';
const SENHA_NOVA = 'definitiva-456';

const CORPO: ChangePasswordPayload = { currentPassword: SENHA_ATUAL, newPassword: SENHA_NOVA };

const CHAVE_DE_CACHE = incidentQueryKeys.list(DEFAULT_INCIDENT_FILTERS);

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function serveChangePassword(
  responder: () => Response = () => new HttpResponse(null, { status: 204 }),
): { urls: string[]; corpos: unknown[] } {
  const registro = { urls: [] as string[], corpos: [] as unknown[] };
  server.use(
    http.post('*/auth/change-password', async ({ request }) => {
      registro.urls.push(request.url);
      registro.corpos.push(await request.json());
      return responder();
    }),
  );
  return registro;
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

/** Cliente com uma resposta de sessão anterior já no cache. */
function createSeededClient(): QueryClient {
  const client = createQueryClient();
  client.setQueryData(CHAVE_DE_CACHE, {
    pages: [],
    pageParams: [null],
  });
  return client;
}

beforeEach(() => {
  useAuthStore.setState({
    session: null,
    notice: null,
    pendingPassword: SENHA_ATUAL,
  });
});

describe('useChangePassword — contrato da requisição', () => {
  it('manda a senha atual e a nova no corpo, nunca na URL', async () => {
    const registro = serveChangePassword();
    useAuthStore.setState({ session: null, notice: null, pendingPassword: null });
    const { result } = renderHook(() => useChangePassword(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await result.current.mutateAsync(CORPO);
    });

    expect(registro.corpos).toEqual([
      { currentPassword: 'temporaria-123', newPassword: 'definitiva-456' },
    ]);
    // Senha em query string vaza para log de servidor e histórico do navegador.
    expect(registro.urls[0]).not.toContain('?');
    expect(registro.urls[0]).not.toContain(SENHA_ATUAL);
  });
});

describe('useChangePassword — sucesso', () => {
  it('conclui o primeiro acesso: a sessão perde mustChangePassword e a temporária sai da memória', async () => {
    serveChangePassword();
    useAuthStore.setState({
      session: {
        accessToken: 'token-de-teste-123456',
        tokenType: 'Bearer',
        expiresIn: 28_800,
        expiresAt: Date.now() + 28_800_000,
        mustChangePassword: true,
        user: {
          id: 'user-marcos',
          email: 'marcos.tavares@example.org',
          name: 'Marcos Tavares',
          role: 'REPORTER',
          lastLoginAt: null,
        },
      },
      notice: null,
      pendingPassword: SENHA_ATUAL,
    });

    const { result } = renderHook(() => useChangePassword(), {
      wrapper: createWrapper(createSeededClient()),
    });

    await act(async () => {
      await result.current.mutateAsync(CORPO);
    });

    await waitFor(() => {
      expect(useAuthStore.getState().session?.mustChangePassword).toBe(false);
    });
    // A temporária não serve mais para nada depois da troca.
    expect(useAuthStore.getState().pendingPassword).toBeNull();
  });

  it('na troca obrigatória, limpa o cache: as respostas antigas eram de permissão negada', async () => {
    serveChangePassword();
    useAuthStore.setState({
      session: {
        accessToken: 'token-de-teste-123456',
        tokenType: 'Bearer',
        expiresIn: 28_800,
        expiresAt: Date.now() + 28_800_000,
        mustChangePassword: true,
        user: {
          id: 'user-marcos',
          email: 'marcos.tavares@example.org',
          name: 'Marcos Tavares',
          role: 'REPORTER',
          lastLoginAt: null,
        },
      },
      notice: null,
      pendingPassword: SENHA_ATUAL,
    });
    const client = createSeededClient();
    const { result } = renderHook(() => useChangePassword(), { wrapper: createWrapper(client) });

    await act(async () => {
      await result.current.mutateAsync(CORPO);
    });

    expect(client.getQueryData(CHAVE_DE_CACHE)).toBeUndefined();
  });

  it('na troca voluntária, preserva o cache carregado', async () => {
    serveChangePassword();
    useAuthStore.setState({
      session: {
        accessToken: 'token-de-teste-123456',
        tokenType: 'Bearer',
        expiresIn: 28_800,
        expiresAt: Date.now() + 28_800_000,
        // Sessão já liberada: a troca aqui é escolha da pessoa, pelo menu.
        mustChangePassword: false,
        user: {
          id: 'user-ana',
          email: 'ana@demo.example.com',
          name: 'Ana Paula Ribeiro',
          role: 'ANALYST',
          lastLoginAt: null,
        },
      },
      notice: null,
      pendingPassword: null,
    });
    const client = createSeededClient();
    const { result } = renderHook(() => useChangePassword(), { wrapper: createWrapper(client) });

    await act(async () => {
      await result.current.mutateAsync(CORPO);
    });

    // A sessão já era válida: nada do que está em cache ficou errado por causa
    // da troca de senha, e limpar só faria a triagem recarregar tudo de novo.
    expect(client.getQueryData(CHAVE_DE_CACHE)).toBeDefined();
    await waitFor(() => {
      expect(useAuthStore.getState().session?.mustChangePassword).toBe(false);
    });
  });
});

describe('useChangePassword — falha', () => {
  const SESSAO_OBRIGATORIA = {
    accessToken: 'token-de-teste-123456',
    tokenType: 'Bearer' as const,
    expiresIn: 28_800,
    expiresAt: Date.now() + 28_800_000,
    mustChangePassword: true,
    user: {
      id: 'user-marcos',
      email: 'marcos.tavares@example.org',
      name: 'Marcos Tavares',
      role: 'REPORTER' as const,
      lastLoginAt: null,
    },
  };

  async function tentarTrocar(client: QueryClient): Promise<unknown> {
    const { result } = renderHook(() => useChangePassword(), { wrapper: createWrapper(client) });
    let capturado: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(CORPO);
      } catch (error) {
        capturado = error;
      }
    });
    return capturado;
  }

  it('a senha atual errada sobe tipada e não derruba a sessão', async () => {
    serveChangePassword(() =>
      apiErrorResponse(401, 'INVALID_CREDENTIALS', 'A senha atual está incorreta.'),
    );
    useAuthStore.setState({
      session: SESSAO_OBRIGATORIA,
      notice: null,
      pendingPassword: SENHA_ATUAL,
    });
    const client = createSeededClient();

    const erro = await tentarTrocar(client);

    if (!isApiError(erro)) throw new Error('esperava um ApiError da API');
    expect(erro.status).toBe(401);
    // Um erro de digitação não pode expulsar a pessoa do primeiro acesso.
    expect(useAuthStore.getState().session).not.toBeNull();
    expect(useAuthStore.getState().session?.mustChangePassword).toBe(true);
    expect(useAuthStore.getState().pendingPassword).toBe(SENHA_ATUAL);
    // A sessão continua sem poder usar a API: o cache dela não vale nada, mas
    // também não houve troca — limpar seria efeito de uma operação que falhou.
    expect(client.getQueryData(CHAVE_DE_CACHE)).toBeDefined();
  });

  it('o mesmo 401 vira mensagens diferentes nas duas telas', async () => {
    serveChangePassword(() =>
      apiErrorResponse(401, 'INVALID_CREDENTIALS', 'A senha atual está incorreta.'),
    );
    useAuthStore.setState({
      session: SESSAO_OBRIGATORIA,
      notice: null,
      pendingPassword: SENHA_ATUAL,
    });

    const erro = await tentarTrocar(createSeededClient());

    // O diálogo do menu fala da senha vigente; a tela do primeiro acesso fala da
    // temporária do convite. É o mesmo erro, e o hook não decide a copy.
    expect(describeChangePasswordError(erro)).toBe('A senha atual está incorreta.');
    expect(describePasswordChangeError(erro)).toBe(
      'A senha temporária não confere ou já expirou. Saia e entre novamente.',
    );
  });

  it('a recusa da política vira a mensagem com o mínimo exigido pela API', async () => {
    serveChangePassword(() =>
      apiErrorResponse(422, 'WEAK_PASSWORD', 'A senha não atende à política mínima.', {
        minLength: 12,
        received: 5,
      }),
    );

    const erro = await tentarTrocar(createSeededClient());

    if (!isApiError(erro)) throw new Error('esperava um ApiError da API');
    expect(erro.status).toBe(422);
    // O mínimo vem do `details` da resposta: a tela não repete a política de
    // memória, que poderia estar desatualizada em relação ao servidor.
    expect(describePasswordChangeError(erro)).toBe('A senha deve ter ao menos 12 caracteres.');
  });

  it('não repete a troca quando a senha atual está errada', async () => {
    let tentativas = 0;
    server.use(
      http.post('*/auth/change-password', () => {
        tentativas += 1;
        return apiErrorResponse(401, 'INVALID_CREDENTIALS', 'A senha atual está incorreta.');
      }),
    );

    await tentarTrocar(createSeededClient());

    // Repetir a mesma senha errada só gasta o teto de escrita da API.
    expect(tentativas).toBe(1);
  });
});
