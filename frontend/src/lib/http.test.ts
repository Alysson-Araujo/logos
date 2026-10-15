import { describe, expect, it } from 'vitest';

import {
  ApiError,
  HttpClient,
  MAX_GET_ATTEMPTS,
  MAX_MUTATION_ATTEMPTS,
  computeRetryDelayMs,
  createIdempotencyKey,
  isApiError,
  isVersionConflict,
} from './http';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function envelope(code: string, message: string, details: unknown = null) {
  return {
    error: { code, message, details, requestId: 'req-abc', timestamp: '2026-02-11T12:00:00Z' },
  };
}

interface ClientHarness {
  client: HttpClient;
  delays: number[];
  getCalls: () => number;
}

function createHarness(
  fetchImpl: typeof fetch,
  isOnline: () => boolean = () => true,
): ClientHarness {
  const delays: number[] = [];
  let calls = 0;
  const countingFetch: typeof fetch = (input, init) => {
    calls += 1;
    return fetchImpl(input, init);
  };
  const client = new HttpClient({
    baseUrl: 'http://api.test/api/v1',
    fetchImpl: countingFetch,
    isOnline,
    random: () => 0.5,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  });
  return { client, delays, getCalls: () => calls };
}

describe('HttpClient', () => {
  it('faz retry com backoff exponencial + jitter em 5xx de GET e conclui com sucesso', async () => {
    let failures = 0;
    const harness = createHarness(() => {
      failures += 1;
      if (failures < 3)
        return Promise.resolve(jsonResponse(envelope('INTERNAL_ERROR', 'Instável'), 503));
      return Promise.resolve(jsonResponse({ items: [] }));
    });

    await expect(harness.client.get('/incidents')).resolves.toEqual({ items: [] });

    expect(harness.getCalls()).toBe(3);
    expect(harness.delays).toEqual([1000, 2000]);
  });

  it('esgota as tentativas do GET e devolve ApiError com o código do envelope', async () => {
    const harness = createHarness(() =>
      Promise.resolve(jsonResponse(envelope('SERVICE_UNAVAILABLE', 'Banco fora do ar'), 503)),
    );

    const captured = await harness.client.get('/incidents').catch((cause: unknown) => cause);

    expect(harness.getCalls()).toBe(MAX_GET_ATTEMPTS);
    expect(isApiError(captured)).toBe(true);
    if (isApiError(captured)) {
      expect(captured.status).toBe(503);
      expect(captured.code).toBe('SERVICE_UNAVAILABLE');
      expect(captured.message).toBe('Banco fora do ar');
      expect(captured.requestId).toBe('req-abc');
    }
  });

  it('NÃO faz retry automático em mutação (POST 500): uma única tentativa', async () => {
    const harness = createHarness(() =>
      Promise.resolve(jsonResponse(envelope('INTERNAL_ERROR', 'Falha ao gravar'), 500)),
    );

    const captured = await harness.client
      .post('/incidents/1/status', { status: 'FECHADO' }, { ifMatch: 3, idempotencyKey: 'idem-1' })
      .catch((cause: unknown) => cause);

    expect(harness.getCalls()).toBe(MAX_MUTATION_ATTEMPTS);
    expect(harness.getCalls()).toBe(1);
    expect(harness.delays).toEqual([]);
    expect(isApiError(captured)).toBe(true);
  });

  it('não repete erro de negócio (404) nem em GET', async () => {
    const harness = createHarness(() =>
      Promise.resolve(
        jsonResponse(envelope('INCIDENT_NOT_FOUND', 'Incidente não encontrado'), 404),
      ),
    );

    const captured = await harness.client.get('/incidents/xyz').catch((cause: unknown) => cause);

    expect(harness.getCalls()).toBe(1);
    expect(isApiError(captured)).toBe(true);
    if (isApiError(captured)) {
      expect(captured.status).toBe(404);
      expect(captured.code).toBe('INCIDENT_NOT_FOUND');
    }
  });

  it('expõe details.current quando o servidor responde 409 VERSION_CONFLICT', async () => {
    const harness = createHarness(() =>
      Promise.resolve(
        jsonResponse(
          envelope('VERSION_CONFLICT', 'Alterado por outro analista', {
            current: { id: 'inc-1', version: 4 },
          }),
          409,
        ),
      ),
    );

    const captured = await harness.client
      .post(
        '/incidents/inc-1/status',
        { status: 'FECHADO' },
        { ifMatch: 3, idempotencyKey: 'idem-2' },
      )
      .catch((cause: unknown) => cause);

    expect(isVersionConflict(captured)).toBe(true);
    if (isVersionConflict(captured)) {
      expect(captured.details).toEqual({ current: { id: 'inc-1', version: 4 } });
    }
  });

  it('envia If-Match e Idempotency-Key nas mutações', async () => {
    const capturedHeaders: { ifMatch: string | null; idempotencyKey: string | null }[] = [];
    const harness = createHarness((_input, init) => {
      const headers = new Headers(init?.headers);
      capturedHeaders.push({
        ifMatch: headers.get('If-Match'),
        idempotencyKey: headers.get('Idempotency-Key'),
      });
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    await harness.client.post(
      '/incidents/inc-1/status',
      { status: 'FECHADO' },
      { ifMatch: 7, idempotencyKey: 'idem-7' },
    );

    expect(capturedHeaders).toEqual([{ ifMatch: '"7"', idempotencyKey: 'idem-7' }]);
  });

  it('não toca a rede quando o navegador está offline', async () => {
    const harness = createHarness(
      () => Promise.resolve(jsonResponse({})),
      () => false,
    );

    const captured = await harness.client.get('/incidents').catch((cause: unknown) => cause);

    expect(harness.getCalls()).toBe(0);
    expect(harness.delays).toEqual([]);
    expect(isApiError(captured)).toBe(true);
    if (isApiError(captured)) {
      expect(captured.code).toBe('OFFLINE');
      expect(captured.kind).toBe('offline');
    }
  });

  it('converte estouro de timeout em REQUEST_TIMEOUT (e repete no GET)', async () => {
    const harness = createHarness(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Tempo esgotado', 'AbortError'));
          });
        }),
    );

    const captured = await harness.client
      .get('/incidents', { timeoutMs: 15 })
      .catch((cause: unknown) => cause);

    expect(harness.getCalls()).toBe(MAX_GET_ATTEMPTS);
    expect(isApiError(captured)).toBe(true);
    if (isApiError(captured)) {
      expect(captured.code).toBe('REQUEST_TIMEOUT');
      expect(captured.kind).toBe('timeout');
    }
  });

  it('marca erro de rede sem resposta HTTP', async () => {
    const harness = createHarness(() => Promise.reject(new TypeError('Failed to fetch')));

    const captured = await harness.client.get('/incidents').catch((cause: unknown) => cause);

    expect(harness.getCalls()).toBe(MAX_GET_ATTEMPTS);
    if (isApiError(captured)) {
      expect(captured.kind).toBe('network');
      expect(captured.code).toBe('NETWORK_ERROR');
    }
  });

  it('faz o parse do corpo 204 sem conteúdo', async () => {
    const harness = createHarness(() => Promise.resolve(new Response(null, { status: 204 })));

    await expect(harness.client.delete('/incidents/inc-1')).resolves.toBeUndefined();
  });
});

describe('backoff', () => {
  it('usa 1s, 2s e 4s com jitter de ±30%', () => {
    expect(computeRetryDelayMs(1, () => 0.5)).toBe(1000);
    expect(computeRetryDelayMs(2, () => 0.5)).toBe(2000);
    expect(computeRetryDelayMs(3, () => 0.5)).toBe(4000);
    expect(computeRetryDelayMs(1, () => 0)).toBe(700);
    expect(computeRetryDelayMs(1, () => 1)).toBe(1300);
  });

  it('mantém a política documentada: 4 tentativas no GET e 1 na mutação', () => {
    expect(MAX_GET_ATTEMPTS).toBe(4);
    expect(MAX_MUTATION_ATTEMPTS).toBe(1);
  });
});

describe('createIdempotencyKey', () => {
  it('devolve uma chave não vazia e distinta', () => {
    const first = createIdempotencyKey();
    const second = createIdempotencyKey();
    expect(first.length).toBeGreaterThan(10);
    expect(first).not.toBe(second);
  });
});

describe('ApiError', () => {
  it('serializa detalhes técnicos para o botão de copiar', () => {
    const error = new ApiError({
      status: 409,
      code: 'VERSION_CONFLICT',
      message: 'Alterado',
      details: { current: { version: 4 } },
      requestId: 'req-1',
    });

    expect(JSON.parse(error.toTechnicalDetails())).toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      requestId: 'req-1',
    });
  });
});
