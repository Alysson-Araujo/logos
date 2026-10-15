import { DEFAULT_BASE_URL, HttpClient, READ_TIMEOUT_MS } from '@/lib/http';

/** Base da API: sempre por variável de ambiente, nunca hardcoded no código de tela. */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL;

function readTimeoutFromEnv(): number {
  const raw = import.meta.env.VITE_REQUEST_TIMEOUT_MS;
  if (raw === undefined) return READ_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : READ_TIMEOUT_MS;
}

/** Cliente único da aplicação (leituras 10s, escritas 15s). */
export const httpClient = new HttpClient({
  baseUrl: API_BASE_URL,
  readTimeoutMs: readTimeoutFromEnv(),
});
