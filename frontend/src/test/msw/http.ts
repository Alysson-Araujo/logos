import { HttpResponse, delay as delayResponse } from 'msw';

/**
 * Peças comuns dos handlers da API simulada: base, envelope de erro único e a
 * latência artificial que faz o modo de desenvolvimento parecer rede de
 * verdade (nos testes ela é zero).
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1').replace(
  /\/+$/,
  '',
);

const MOCK_LATENCY_MIN_MS = 90;
const MOCK_LATENCY_JITTER_MS = 170;

let requestCounter = 0;

export function apiPath(path: string): string {
  return `${API_BASE}${path}`;
}

function createRequestId(): string {
  requestCounter += 1;
  return `mock-${Date.now().toString(36)}-${String(requestCounter)}`;
}

/** Mesmo envelope de erro da API (`{ error: { code, message, details, … } }`). */
export function apiError(
  status: number,
  code: string,
  message: string,
  details: unknown = null,
  headers: Record<string, string> = {},
) {
  return HttpResponse.json(
    {
      error: {
        code,
        message,
        details,
        requestId: createRequestId(),
        timestamp: new Date().toISOString(),
      },
    },
    { status, headers },
  );
}

/** Atraso só no modo de desenvolvimento: testar com latência é flakiness. */
export async function simulateLatency(): Promise<void> {
  if (import.meta.env.MODE === 'test') return;
  await delayResponse(MOCK_LATENCY_MIN_MS + Math.random() * MOCK_LATENCY_JITTER_MS);
}
