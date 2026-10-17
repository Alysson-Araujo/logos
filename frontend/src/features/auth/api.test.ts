/**
 * Ambiente `node` de propósito: o `fetch` do Node (undici) recusa o
 * `AbortSignal` criado no realm do jsdom, e o MSW roda no processo do Node —
 * mesma razão registrada em `features/incidents/api/endpoints.test.ts`.
 *
 * @vitest-environment node
 */
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { configureAuth, isApiError } from '@/lib/http';
import { server } from '@/test/setup';

import { login, revokeSessionToken } from './api';
import { DEMO_CREDENTIALS } from './demo';

const VALID_RESPONSE = {
  accessToken: 'token-de-teste-123456',
  tokenType: 'Bearer',
  expiresIn: 28_800,
  user: {
    id: 'user-ana',
    email: DEMO_CREDENTIALS.email,
    name: 'Ana Paula Ribeiro',
    role: 'ANALYST',
    lastLoginAt: null,
  },
};

describe('login', () => {
  it('transforma a resposta da API na sessão da aplicação', async () => {
    const before = Date.now();

    const session = await login({ ...DEMO_CREDENTIALS });

    const after = Date.now();
    // O token é opaco: o que importa é ser longo o bastante para o schema.
    expect(session.accessToken).toMatch(/^mock-token-\d+$/);
    expect(session.accessToken.length).toBeGreaterThanOrEqual(10);
    expect(session.tokenType).toBe('Bearer');
    expect(session.user.name).toBe('Ana Paula Ribeiro');
    expect(session.user.role).toBe('ANALYST');
    expect(session.user.lastLoginAt).toBeNull();

    // A validade é calculada localmente: nada de 401 previsível.
    expect(session.expiresAt).toBeGreaterThanOrEqual(before + session.expiresIn * 1000);
    expect(session.expiresAt).toBeLessThanOrEqual(after + session.expiresIn * 1000);
  });

  it('devolve erro tipado quando a credencial não confere', async () => {
    const error = await login({ email: DEMO_CREDENTIALS.email, password: 'errada' }).catch(
      (caught: unknown) => caught,
    );

    expect(isApiError(error)).toBe(true);
    if (!isApiError(error)) throw new Error('esperava um erro tipado da API');
    expect(error.status).toBe(401);
    expect(error.code).toBe('INVALID_CREDENTIALS');
  });

  it('não manda token no login, mesmo com sessão aberta', async () => {
    let seen: string | null = null;
    server.use(
      http.post('*/auth/login', ({ request }) => {
        seen = request.headers.get('authorization');
        return HttpResponse.json(VALID_RESPONSE);
      }),
    );
    configureAuth({ getToken: () => 'token-de-sessao-anterior', onUnauthorized: () => undefined });

    await login({ ...DEMO_CREDENTIALS });

    expect(seen).toBeNull();
    configureAuth(null);
  });

  it('recusa resposta fora do contrato', async () => {
    server.use(http.post('*/auth/login', () => HttpResponse.json({ accessToken: 'curto' })));

    const error = await login({ ...DEMO_CREDENTIALS }).catch((caught: unknown) => caught);

    expect(isApiError(error)).toBe(true);
    if (!isApiError(error)) throw new Error('esperava um erro tipado da API');
    expect(error.kind).toBe('contract');
    expect(error.code).toBe('CONTRACT_ERROR');
  });
});

describe('revokeSessionToken', () => {
  it('resolve quando a API confirma a revogação', async () => {
    await expect(revokeSessionToken()).resolves.toBeUndefined();
  });

  it('não impede a saída quando a API está fora do ar', async () => {
    server.use(http.post('*/auth/logout', () => HttpResponse.error()));

    await expect(revokeSessionToken()).resolves.toBeUndefined();
  });
});
