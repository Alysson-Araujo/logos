import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { isApiError } from '@/lib/http';
import { createQueryClient } from '@/lib/queryClient';
import { readMockInvitePassword } from '@/test/msw/users';
import { server } from '@/test/setup';

import { LOGIN_INVALID_CREDENTIALS, describeLoginError } from '../labels';
import type { LoginCredentials } from '../types';
import { useAuthStore } from '../useAuthStore';
import { useLogin } from './useLogin';

/**
 * Entrada na aplicação (`POST /auth/login`).
 *
 * O que este teste protege: o caminho por onde passa a credencial. Três coisas
 * podem dar errado e todas aparecem aqui. Sessão **pela metade** — o token chega
 * mas não é guardado, e a pessoa "entra" para voltar ao login na primeira
 * requisição. Sessão criada a partir de **senha errada** — o erro precisa subir
 * tipado e nada pode ser gravado. E a **senha temporária do convite**, que só
 * pode existir em memória: ela é necessária para a troca obrigatória (é a senha
 * "atual" daquela chamada) e nunca pode ir para o `sessionStorage`, que qualquer
 * script da página lê.
 */

const CREDENCIAIS_VALIDAS: LoginCredentials = {
  email: 'ana@demo.example.com',
  password: 'ana.logos2026',
};

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderLogin() {
  return renderHook(() => useLogin(), { wrapper: createWrapper(createQueryClient()) });
}

/** Roda a mutação e devolve o erro, sem deixar a promessa rejeitada solta. */
async function tentarEntrar(
  result: { current: ReturnType<typeof useLogin> },
  credentials: LoginCredentials,
): Promise<unknown> {
  let capturado: unknown;
  await act(async () => {
    try {
      await result.current.mutateAsync(credentials);
    } catch (error) {
      capturado = error;
    }
  });
  return capturado;
}

beforeEach(() => {
  useAuthStore.setState({ session: null, notice: null, pendingPassword: null });
});

describe('useLogin — sucesso', () => {
  it('guarda a sessão na aba, pronta para a triagem', async () => {
    const { result } = renderLogin();

    await act(async () => {
      await result.current.mutateAsync(CREDENCIAIS_VALIDAS);
    });

    const sessao = useAuthStore.getState().session;
    expect(sessao?.user.email).toBe('ana@demo.example.com');
    expect(sessao?.accessToken).toBeTruthy();
    expect(sessao?.mustChangePassword).toBe(false);
    // Sem senha pendente: a troca obrigatória não está no caminho.
    expect(useAuthStore.getState().pendingPassword).toBeNull();
    // A sessão vive na aba: recarregar mantém, fechar encerra.
    expect(window.sessionStorage.getItem('logos-session')).not.toBeNull();
  });

  it('limpa o aviso da tela de login quando a entrada dá certo', async () => {
    useAuthStore.setState({ notice: 'Sua sessão expirou. Entre novamente.' });
    const { result } = renderLogin();

    await act(async () => {
      await result.current.mutateAsync(CREDENCIAIS_VALIDAS);
    });

    expect(useAuthStore.getState().notice).toBeNull();
  });

  it('no primeiro acesso, a senha temporária fica em memória — e só nela', async () => {
    const email = 'marcos.tavares@example.org';
    const senhaTemporaria = readMockInvitePassword(email);
    if (senhaTemporaria === null) throw new Error('o convite do seed mudou de forma');

    const { result } = renderLogin();
    await act(async () => {
      await result.current.mutateAsync({ email, password: senhaTemporaria });
    });

    expect(useAuthStore.getState().session?.mustChangePassword).toBe(true);
    // A troca obrigatória precisa dela como senha "atual": sem isso a pessoa
    // seria expulsa para o login no meio do primeiro acesso.
    expect(useAuthStore.getState().pendingPassword).toBe(senhaTemporaria);
    // E ela NÃO pode estar no storage, que é lido por qualquer script da página.
    const persistido = window.sessionStorage.getItem('logos-session') ?? '';
    expect(persistido).not.toBe('');
    expect(persistido).not.toContain(senhaTemporaria);
  });

  it('resposta antiga do servidor, sem mustChangePassword, não prende ninguém', async () => {
    server.use(
      http.post('*/auth/login', () =>
        HttpResponse.json({
          accessToken: 'token-de-teste-123456',
          tokenType: 'Bearer',
          expiresIn: 28_800,
          user: {
            id: 'user-ana',
            email: 'ana@demo.example.com',
            name: 'Ana Paula Ribeiro',
            role: 'ANALYST',
            lastLoginAt: null,
          },
        }),
      ),
    );

    const { result } = renderLogin();
    await act(async () => {
      await result.current.mutateAsync(CREDENCIAIS_VALIDAS);
    });

    // O campo é opcional no contrato: a ausência vale `false`, senão um servidor
    // mais antigo mandaria todo mundo para a tela de definir senha.
    expect(useAuthStore.getState().session?.mustChangePassword).toBe(false);
    expect(useAuthStore.getState().pendingPassword).toBeNull();
  });
});

describe('useLogin — falha', () => {
  it('senha errada não cria sessão', async () => {
    const { result } = renderLogin();

    const erro = await tentarEntrar(result, {
      email: 'ana@demo.example.com',
      password: 'senha-errada',
    });

    if (!isApiError(erro)) throw new Error('esperava um ApiError da API');
    expect(erro.status).toBe(401);
    expect(erro.code).toBe('INVALID_CREDENTIALS');
    // Nada de sessão fantasma: quem não entrou continua na tela de login.
    expect(useAuthStore.getState().session).toBeNull();
    expect(window.sessionStorage.getItem('logos-session')).toBeNull();
    // A mensagem que a pessoa lê vem do código, não do texto do servidor.
    expect(describeLoginError(erro)).toBe(LOGIN_INVALID_CREDENTIALS);
  });

  it('não repete a tentativa quando a senha está errada', async () => {
    let tentativas = 0;
    server.use(
      http.post('*/auth/login', () => {
        tentativas += 1;
        return HttpResponse.json(
          {
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Credenciais inválidas.',
              requestId: 'req-401',
              timestamp: new Date().toISOString(),
            },
          },
          { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
        );
      }),
    );

    const { result } = renderLogin();
    await tentarEntrar(result, { email: 'ana@demo.example.com', password: 'errada' });

    // Repetir só aceleraria o bloqueio por tentativa: errar a senha não melhora
    // na segunda vez.
    expect(tentativas).toBe(1);
  });

  it('resposta fora do contrato vira erro de servidor, sem meia sessão', async () => {
    server.use(
      http.post('*/auth/login', () =>
        HttpResponse.json({
          // `accessToken` curto demais: o contrato exige ao menos 10 caracteres.
          accessToken: 'curto',
          tokenType: 'Bearer',
          expiresIn: 28_800,
          user: { id: 'user-ana', email: 'ana@demo.example.com', name: 'Ana', role: 'ANALYST' },
        }),
      ),
    );

    const { result } = renderLogin();
    const erro = await tentarEntrar(result, CREDENCIAIS_VALIDAS);

    if (!isApiError(erro)) throw new Error('esperava um ApiError de contrato');
    expect(erro.kind).toBe('contract');
    expect(useAuthStore.getState().session).toBeNull();
    // Entrar com um token que o resto da aplicação não aceita seria pior que
    // dizer que a API falhou.
    expect(describeLoginError(erro)).toMatch(/A API falhou/);
  });
});
