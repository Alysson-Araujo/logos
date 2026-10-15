/// <reference types="vite/client" />

/**
 * Variáveis de ambiente consumidas pelo front. Tipadas para que o código
 * não trate `import.meta.env.*` como `any`.
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_MOCK?: string;
  readonly VITE_REQUEST_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
