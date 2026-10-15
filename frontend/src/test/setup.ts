import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { handlers, resetMockDatabase } from './msw/handlers';

/** API simulada no ambiente de teste (mesmos handlers do modo de desenvolvimento). */
export const server = setupServer(...handlers);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockDatabase();

  // Alguns testes rodam no ambiente `node` (sem DOM) — daí a checagem.
  const browserWindow = globalThis.window as Window | undefined;
  if (browserWindow !== undefined) {
    browserWindow.localStorage.clear();
    browserWindow.history.replaceState(null, '', '/');

    // jsdom não implementa `matchMedia`, usado pelo tema claro/escuro.
    if (typeof browserWindow.matchMedia !== 'function') {
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
  }
});

afterAll(() => {
  server.close();
});
