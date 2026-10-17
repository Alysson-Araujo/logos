import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { handlers, resetMockDatabase } from './msw/handlers';

/** API simulada no ambiente de teste (mesmos handlers do modo de desenvolvimento). */
export const server = setupServer(...handlers);

/**
 * O jsdom não implementa `matchMedia`, usado pelo tema claro/escuro. Precisa
 * existir **antes** do primeiro teste: a tela de login monta o seletor de tema
 * já na primeira renderização.
 */
function installMatchMediaStub(): void {
  const browserWindow = globalThis.window as Window | undefined;
  if (browserWindow === undefined) return;
  if (typeof browserWindow.matchMedia === 'function') return;

  Object.defineProperty(browserWindow, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  installMatchMediaStub();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockDatabase();

  // Alguns testes rodam no ambiente `node` (sem DOM) — daí a checagem.
  const browserWindow = globalThis.window as Window | undefined;
  if (browserWindow !== undefined) {
    browserWindow.localStorage.clear();
    // A sessão vive em `sessionStorage`: sem isto, um teste entrega a sessão
    // do anterior para o próximo.
    browserWindow.sessionStorage.clear();
    browserWindow.history.replaceState(null, '', '/');
    installMatchMediaStub();
  }
});

afterAll(() => {
  server.close();
});
