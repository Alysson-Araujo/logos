import { afterEach, describe, expect, it } from 'vitest';

import { ApiError, configureAuth, HttpClient } from './http';

/**
 * Ponte entre o cliente HTTP e a sessão: cabeçalho `Authorization`, dispensa
 * do login e reação ao 401. O arquivo é separado de `http.test.ts` porque
 * cobre uma responsabilidade distinta — a sessão.
 */

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClient(responder: (url: string, init: RequestInit) => Response): {
  client: HttpClient;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const client = new HttpClient({
    fetchImpl: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const options = init ?? {};
      calls.push({ url, init: options });
      return Promise.resolve(responder(url, options));
    },
  });
  return { client, calls };
}

function headerOf(call: CapturedRequest, name: string): string | null {
  const { headers } = call.init;
  return headers instanceof Headers ? headers.get(name) : null;
}

function unauthorized(code: string, status = 401): Response {
  return jsonResponse(
    {
      error: {
        code,
        message: 'Não autorizado.',
        details: null,
        requestId: 'req-1',
        timestamp: '2026-10-16T00:00:00Z',
      },
    },
    status,
  );
}

afterEach(() => {
  configureAuth(null);
});

describe('Authorization', () => {
  it('envia o token da sessão', async () => {
    configureAuth({ getToken: () => 'token-da-sessao', onUnauthorized: () => undefined });
    const { client, calls } = createClient(() => jsonResponse({ ok: true }));

    await client.get('/incidents');

    const call = calls[0];
    expect(call).toBeDefined();
    expect(headerOf(call as CapturedRequest, 'Authorization')).toBe('Bearer token-da-sessao');
  });

  it('não envia cabeçalho quando não há sessão', async () => {
    configureAuth({ getToken: () => null, onUnauthorized: () => undefined });
    const { client, calls } = createClient(() => jsonResponse({ ok: true }));

    await client.get('/incidents');

    expect(headerOf(calls[0] as CapturedRequest, 'Authorization')).toBeNull();
  });

  it('não envia token no login, mesmo com sessão aberta', async () => {
    configureAuth({ getToken: () => 'token-da-sessao', onUnauthorized: () => undefined });
    const { client, calls } = createClient(() => jsonResponse({ ok: true }));

    await client.post('/auth/login', { email: 'a@b.com', password: 'x' }, { skipAuth: true });

    expect(headerOf(calls[0] as CapturedRequest, 'Authorization')).toBeNull();
  });

  it('funciona com o cliente sem ponte configurada', async () => {
    const { client, calls } = createClient(() => jsonResponse({ ok: true }));

    await client.get('/incidents');

    expect(headerOf(calls[0] as CapturedRequest, 'Authorization')).toBeNull();
  });
});

describe('401', () => {
  it('avisa o ouvinte numa chamada autenticada', async () => {
    const seen: ApiError[] = [];
    configureAuth({
      getToken: () => 'token-vencido',
      onUnauthorized: (error) => {
        seen.push(error);
      },
    });
    const { client } = createClient(() => unauthorized('TOKEN_EXPIRED'));

    await expect(client.get('/incidents')).rejects.toThrow(ApiError);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.code).toBe('TOKEN_EXPIRED');
    expect(seen[0]?.status).toBe(401);
  });

  it('não avisa o ouvinte quando o 401 é do próprio login', async () => {
    const seen: ApiError[] = [];
    configureAuth({
      getToken: () => null,
      onUnauthorized: (error) => {
        seen.push(error);
      },
    });
    const { client } = createClient(() => unauthorized('INVALID_CREDENTIALS'));

    await expect(
      client.post('/auth/login', { email: 'a@b.com', password: 'x' }, { skipAuth: true }),
    ).rejects.toThrow(ApiError);

    expect(seen).toHaveLength(0);
  });

  it('não avisa em erro que não é 401', async () => {
    const seen: ApiError[] = [];
    configureAuth({
      getToken: () => 'token',
      onUnauthorized: (error) => {
        seen.push(error);
      },
    });
    const { client } = createClient(() => unauthorized('FORBIDDEN', 403));

    await expect(client.get('/incidents')).rejects.toThrow(ApiError);

    expect(seen).toHaveLength(0);
  });
});
