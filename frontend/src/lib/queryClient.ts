import { QueryClient } from '@tanstack/react-query';

import { computeRetryDelayMs, isRetryableApiError } from './http';

export const STALE_TIME_MS = 30_000;
export const GC_TIME_MS = 5 * 60_000;
/**
 * Camadas de retry, de propósito:
 *  - `HttpClient` cuida do transporte (3 retries: 1s, 2s, 4s + jitter);
 *  - o cache repete mais 2 vezes para cobrir falhas longas (backend reiniciando).
 * O pior caso fica limitado, sem tempestade de requisições.
 */
export const MAX_QUERY_RETRIES = 2;

/**
 * Política de retry das leituras: apenas transporte/5xx, no máximo 3 tentativas.
 * Erros de contrato (4xx) não são repetidos — repetir não resolveria.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  return isRetryableApiError(error);
}

/** `attemptIndex` é 0-based (TanStack) → convertido para 1-based (1s, 2s, 4s). */
export function retryDelay(attemptIndex: number): number {
  return computeRetryDelayMs(attemptIndex + 1);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        gcTime: GC_TIME_MS,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        networkMode: 'offlineFirst',
        retry: shouldRetryQuery,
        retryDelay,
      },
      mutations: {
        networkMode: 'online',
        retry: false,
      },
    },
  });
}

/** Cliente único da aplicação (injetado no `QueryClientProvider`). */
export const queryClient = createQueryClient();
