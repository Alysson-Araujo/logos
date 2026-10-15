/**
 * Cliente HTTP do Logos — escrito à mão (sem axios).
 *
 * Responsabilidades:
 *  - timeout por requisição via `AbortController` (10s leitura / 15s escrita);
 *  - retry com backoff exponencial **e jitter** apenas em GET;
 *  - `Idempotency-Key` estável por tentativa do usuário (gerada no hook de mutação);
 *  - parse do envelope de erro único da API em `ApiError`;
 *  - consciência de `navigator.onLine`.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Origem do erro, usada para decidir retry e para a UI escolher o estado. */
export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'aborted' | 'offline' | 'contract';

export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  kind?: ApiErrorKind;
  details?: unknown;
  requestId?: string | null;
  timestamp?: string | null;
  retryAfterSeconds?: number | null;
  cause?: unknown;
}

/** Erro tipado da API: carrega status HTTP, código de negócio e detalhes. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly kind: ApiErrorKind;
  readonly details: unknown;
  readonly requestId: string | null;
  readonly timestamp: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.kind = init.kind ?? 'http';
    this.details = init.details ?? null;
    this.requestId = init.requestId ?? null;
    this.timestamp = init.timestamp ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    if (init.cause !== undefined) {
      this.cause = init.cause;
    }
  }

  /** `true` quando a falha foi de transporte (rede, timeout, offline). */
  get isTransportError(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || this.kind === 'offline';
  }

  /** Detalhes técnicos prontos para o botão "Copiar detalhes técnicos". */
  toTechnicalDetails(): string {
    return JSON.stringify(
      {
        status: this.status,
        code: this.code,
        kind: this.kind,
        message: this.message,
        requestId: this.requestId,
        timestamp: this.timestamp,
        details: this.details,
      },
      null,
      2,
    );
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Conflito de versão (dois analistas no mesmo caso). */
export function isVersionConflict(error: unknown): error is ApiError {
  return isApiError(error) && error.code === 'VERSION_CONFLICT';
}

/** Erro de contrato (resposta fora do envelope esperado). */
export function isContractError(error: unknown): boolean {
  return isApiError(error) && error.kind === 'contract';
}

/** Só faz sentido tentar de novo em falha de transporte ou 5xx. */
export function isRetryableApiError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (error.kind === 'network' || error.kind === 'timeout') return true;
  return error.kind === 'http' && error.status >= 500;
}

/* ------------------------------------------------------------------ */
/* Tempo e retrocesso                                                  */
/* ------------------------------------------------------------------ */

export const READ_TIMEOUT_MS = 10_000;
export const WRITE_TIMEOUT_MS = 15_000;
/** 1 tentativa + 3 retries (1s, 2s, 4s). */
export const MAX_GET_ATTEMPTS = 4;
/** Mutações não têm retry automático. */
export const MAX_MUTATION_ATTEMPTS = 1;
export const JITTER_RATIO = 0.3;

/**
 * Backoff exponencial (1s, 2s, 4s…) com jitter de ±30% para evitar
 * "thundering herd" quando o backend volta.
 */
export function computeRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = 1000 * 2 ** (attempt - 1);
  const jitter = exponential * JITTER_RATIO * (random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

export function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/* ------------------------------------------------------------------ */
/* Query string                                                        */
/* ------------------------------------------------------------------ */

export type QueryValue =
  string | number | boolean | null | undefined | readonly (string | number)[];
export type QueryParams = Record<string, QueryValue>;

function isCsvValue(value: QueryValue): value is readonly (string | number)[] {
  return Array.isArray(value);
}

/** Serializa parâmetros; arrays viram CSV, como o contrato exige. */
export function buildQueryString(params: QueryParams | undefined): string {
  if (params === undefined) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    if (isCsvValue(value)) {
      const csv = value.map((item) => String(item)).join(',');
      if (csv !== '') search.set(key, csv);
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

/* ------------------------------------------------------------------ */
/* Parse defensivo do corpo                                            */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

const DEFAULT_STATUS_MESSAGES: Record<number, string> = {
  400: 'Requisição inválida.',
  401: 'Não autorizado.',
  403: 'Acesso negado.',
  404: 'Recurso não encontrado.',
  409: 'Os dados mudaram desde a última leitura.',
  412: 'A versão enviada não é mais válida.',
  422: 'Os dados enviados não passaram na validação.',
  429: 'Muitas requisições. Aguarde alguns instantes.',
  500: 'Erro interno no servidor.',
  503: 'Serviço temporariamente indisponível.',
};

function defaultMessageFor(status: number): string {
  return DEFAULT_STATUS_MESSAGES[status] ?? 'Não foi possível concluir a operação.';
}

function readRetryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get('Retry-After');
  if (raw === null) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Extrai a mensagem do envelope único de erro; aceita também `detail` cru. */
export function createApiErrorFromResponse(response: Response, body: unknown): ApiError {
  const retryAfterSeconds = readRetryAfterSeconds(response);
  if (isRecord(body)) {
    const envelope = isRecord(body.error) ? body.error : null;
    if (envelope !== null) {
      return new ApiError({
        status: response.status,
        code: readString(envelope, 'code') ?? `HTTP_${response.status}`,
        message: readString(envelope, 'message') ?? defaultMessageFor(response.status),
        kind: 'http',
        details: envelope.details ?? null,
        requestId: readString(envelope, 'requestId'),
        timestamp: readString(envelope, 'timestamp'),
        retryAfterSeconds,
      });
    }
    const detail = body.detail;
    if (typeof detail === 'string') {
      return new ApiError({
        status: response.status,
        code: `HTTP_${response.status}`,
        message: detail,
        retryAfterSeconds,
      });
    }
  }
  return new ApiError({
    status: response.status,
    code: `HTTP_${response.status}`,
    message:
      typeof body === 'string' && body.trim() !== '' ? body : defaultMessageFor(response.status),
    retryAfterSeconds,
  });
}

/* ------------------------------------------------------------------ */
/* Requisição                                                          */
/* ------------------------------------------------------------------ */

export interface RetryInfo {
  attempt: number;
  delayMs: number;
  error: ApiError;
}

export interface RequestOptions {
  /** Caminho relativo à base (ex.: `/incidents`). */
  path: string;
  method?: HttpMethod;
  body?: unknown;
  query?: QueryParams;
  /** Chave de idempotência estável por tentativa do usuário. */
  idempotencyKey?: string;
  /** Versão esperada do recurso (lock otimista) → header `If-Match`. */
  ifMatch?: string | number | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Sobrescreve a política de tentativas (usado nos testes). */
  attempts?: number;
  onRetry?: (info: RetryInfo) => void;
}

export interface JsonResult {
  data: unknown;
  etag: string | null;
  status: number;
}

export interface HttpClientConfig {
  baseUrl?: string;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
  maxGetAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  isOnline?: () => boolean;
  random?: () => number;
}

export const DEFAULT_BASE_URL = 'http://localhost:8000/api/v1';

function defaultIsOnline(): boolean {
  // Ambientes sem `navigator.onLine` (Node, por exemplo) seguem otimistas.
  const online: unknown = navigator.onLine;
  return typeof online === 'boolean' ? online : true;
}

/** Gera a `Idempotency-Key` (crypto.randomUUID com degradação defensiva). */
export function createIdempotencyKey(): string {
  const fallback = `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  try {
    const cryptoApi = globalThis.crypto as Crypto | undefined;
    if (cryptoApi === undefined) return fallback;
    return cryptoApi.randomUUID();
  } catch {
    return fallback;
  }
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly readTimeoutMs: number;
  private readonly writeTimeoutMs: number;
  private readonly maxGetAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly isOnline: () => boolean;
  private readonly random: () => number;

  constructor(config: HttpClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.readTimeoutMs = config.readTimeoutMs ?? READ_TIMEOUT_MS;
    this.writeTimeoutMs = config.writeTimeoutMs ?? WRITE_TIMEOUT_MS;
    this.maxGetAttempts = config.maxGetAttempts ?? MAX_GET_ATTEMPTS;
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = config.sleep ?? sleepFor;
    this.isOnline = config.isOnline ?? defaultIsOnline;
    this.random = config.random ?? Math.random;
  }

  get(
    path: string,
    options: Omit<RequestOptions, 'method' | 'body' | 'path'> = {},
  ): Promise<unknown> {
    return this.request({ path, ...options, method: 'GET' });
  }

  getWithMeta(
    path: string,
    options: Omit<RequestOptions, 'method' | 'body' | 'path'> = {},
  ): Promise<JsonResult> {
    return this.requestDetailed({ path, ...options, method: 'GET' });
  }

  post(
    path: string,
    body: unknown,
    options: Omit<RequestOptions, 'method' | 'body' | 'path'> = {},
  ): Promise<unknown> {
    return this.request({ path, ...options, method: 'POST', body });
  }

  patch(
    path: string,
    body: unknown,
    options: Omit<RequestOptions, 'method' | 'body' | 'path'> = {},
  ): Promise<unknown> {
    return this.request({ path, ...options, method: 'PATCH', body });
  }

  delete(
    path: string,
    options: Omit<RequestOptions, 'method' | 'body' | 'path'> = {},
  ): Promise<void> {
    return this.request({ path, ...options, method: 'DELETE' }).then(() => undefined);
  }

  async request(options: RequestOptions & { method: HttpMethod }): Promise<unknown> {
    const result = await this.requestDetailed(options);
    return result.data;
  }

  async requestDetailed(options: RequestOptions & { method: HttpMethod }): Promise<JsonResult> {
    const method = options.method;
    const isRead = method === 'GET';
    const attempts = options.attempts ?? (isRead ? this.maxGetAttempts : MAX_MUTATION_ATTEMPTS);
    const timeoutMs = options.timeoutMs ?? (isRead ? this.readTimeoutMs : this.writeTimeoutMs);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.sendOnce({ ...options, method, timeoutMs });
      } catch (error) {
        const apiError = toApiError(error);
        const canRetry =
          attempt < attempts &&
          isRetryableApiError(apiError) &&
          apiError.kind !== 'aborted' &&
          options.signal?.aborted !== true;
        if (!canRetry) throw apiError;

        const delayMs = computeRetryDelayMs(attempt, this.random);
        options.onRetry?.({ attempt, delayMs, error: apiError });
        await this.sleep(delayMs);
      }
    }

    throw new ApiError({
      status: 0,
      code: 'RETRY_EXHAUSTED',
      message: 'Não foi possível completar a requisição após várias tentativas.',
      kind: 'network',
    });
  }

  private async sendOnce(
    options: RequestOptions & { method: HttpMethod; timeoutMs: number },
  ): Promise<JsonResult> {
    if (!this.isOnline()) {
      throw new ApiError({
        status: 0,
        code: 'OFFLINE',
        message: 'Sem conexão — exibindo os últimos dados carregados.',
        kind: 'offline',
      });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, options.timeoutMs);

    const externalSignal = options.signal;
    const abortFromCaller = (): void => {
      controller.abort();
    };
    if (externalSignal !== undefined) {
      if (externalSignal.aborted) {
        clearTimeout(timeoutId);
        throw abortedError();
      }
      externalSignal.addEventListener('abort', abortFromCaller, { once: true });
    }

    const url = `${this.baseUrl}${options.path}${buildQueryString(options.query)}`;
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.idempotencyKey !== undefined)
      headers.set('Idempotency-Key', options.idempotencyKey);
    if (options.ifMatch !== undefined && options.ifMatch !== null) {
      headers.set('If-Match', `"${String(options.ifMatch).replace(/"/g, '')}"`);
    }

    const init: RequestInit = { method: options.method, headers, signal: controller.signal };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);

    try {
      const fetchImpl = this.fetchImpl;
      const response = await fetchImpl(url, init);
      if (!response.ok) {
        const errorBody = await readBody(response);
        throw createApiErrorFromResponse(response, errorBody);
      }
      if (response.status === 204) {
        return { data: null, etag: response.headers.get('ETag'), status: response.status };
      }
      const data = await readBody(response);
      return { data, etag: response.headers.get('ETag'), status: response.status };
    } catch (error) {
      if (isApiError(error)) throw error;
      // O abort veio do nosso timer (e não do chamador) → é estouro de timeout.
      if (controller.signal.aborted && externalSignal?.aborted !== true) {
        throw new ApiError({
          status: 0,
          code: 'REQUEST_TIMEOUT',
          message: `A API não respondeu em ${String(Math.round(options.timeoutMs / 1000))}s.`,
          kind: 'timeout',
          cause: error,
        });
      }
      if (externalSignal?.aborted === true) throw abortedError();
      throw new ApiError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: 'Falha de rede ao falar com a API.',
        kind: 'network',
        cause: error,
      });
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

function abortedError(): ApiError {
  return new ApiError({
    status: 0,
    code: 'REQUEST_ABORTED',
    message: 'Requisição cancelada.',
    kind: 'aborted',
  });
}

function toApiError(error: unknown): ApiError {
  if (isApiError(error)) return error;
  return new ApiError({
    status: 0,
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : 'Erro inesperado.',
    kind: 'network',
    cause: error,
  });
}

async function readBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      const parsed: unknown = await response.json();
      return parsed;
    } catch {
      return null;
    }
  }
  try {
    const text = await response.text();
    return text === '' ? null : text;
  } catch {
    return null;
  }
}

/** Instância compartilhada usada pelos endpoints (base configurável por env). */
export const httpClient = new HttpClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? DEFAULT_BASE_URL,
  readTimeoutMs: readTimeoutFromEnv(),
});

function readTimeoutFromEnv(): number {
  const raw = import.meta.env.VITE_REQUEST_TIMEOUT_MS;
  if (raw === undefined) return READ_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : READ_TIMEOUT_MS;
}
