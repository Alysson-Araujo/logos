import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { handlers, resetMockAccounts, resetMockDatabase } from './msw/handlers';

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

/**
 * O jsdom não implementa `scrollIntoView`, usado pelo guia para trazer o alvo
 * para dentro da dobra (o rodapé, em telas baixas). Sem o stub o efeito
 * quebraria em `TypeError` em vez de simplesmente não rolar.
 */
function installScrollIntoViewStub(): void {
  // No ambiente `node` (usado pelos testes de API) não existe `Element`, então
  // o construtor é lido do global e checado antes do uso.
  const ctorElemento = (globalThis as { Element?: unknown }).Element as
    { prototype: Record<string, unknown> } | undefined;
  if (ctorElemento === undefined) return;
  const elementPrototype = ctorElemento.prototype;
  if (typeof elementPrototype.scrollIntoView === 'function') return;

  Object.defineProperty(elementPrototype, 'scrollIntoView', {
    writable: true,
    configurable: true,
    value: () => undefined,
  });
}

/**
 * O jsdom não traz o que o Radix precisa para posicionar menus e diálogos
 * (`ResizeObserver` e captura de ponteiro). Sem estes apelidos, montar o menu
 * do usuário derruba a renderização inteira do teste — não só a interação com
 * o menu.
 */
function installRadixStubs(): void {
  const escopo = globalThis as unknown as Record<string, unknown>;
  if (typeof escopo.ResizeObserver !== 'function') {
    escopo.ResizeObserver = class {
      observe = (): void => undefined;
      unobserve = (): void => undefined;
      disconnect = (): void => undefined;
    };
  }

  // Mesma guarda do stub acima: no ambiente `node` não existe `Element`.
  const ctorElemento = (globalThis as { Element?: unknown }).Element as
    { prototype: Record<string, unknown> } | undefined;
  if (ctorElemento === undefined) return;
  const proto = ctorElemento.prototype;
  // Atribuição direta, e não `??=`: o jsdom *declara* estes métodos sem os
  // implementar, então a checagem de nulidade não pegaria nenhum deles.
  proto.hasPointerCapture = () => false;
  proto.setPointerCapture = () => undefined;
  proto.releasePointerCapture = () => undefined;
}

let isFetchBridged = false;

/**
 * Ponte entre o `AbortSignal` do jsdom e o `fetch` do Node.
 *
 * O MSW remonta a requisição interceptada com `new Request(url, { signal })`, e
 * o `Request` do undici recusa um signal de outro realm ("Expected signal to be
 * an instance of AbortSignal"). Como no jsdom **todo** signal é desse realm, o
 * MSW não interceptava nada: a chamada morria como erro de rede e o teste via
 * a mensagem genérica em vez da resposta da API. A saída é não repassar o
 * signal ao fetch — perde-se o cancelamento da requisição, que em jsdom já não
 * chegava ao fetch de qualquer maneira.
 *
 * Precisa rodar **depois** de `server.listen()`: é o `listen` que troca o
 * `fetch` global pelo do MSW.
 */
function bridgeAbortSignalToFetch(): void {
  if (isFetchBridged) return;
  const currentFetch = globalThis.fetch;

  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal === undefined || init.signal === null) return currentFetch(input, init);
    return currentFetch(input, { ...init, signal: undefined });
  };
  isFetchBridged = true;
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  installMatchMediaStub();
  installScrollIntoViewStub();
  installRadixStubs();
  // Depois do listen: é ele que troca o fetch global pelo do MSW.
  bridgeAbortSignalToFetch();
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMockDatabase();
  // O "banco" de contas também é estado de módulo: convite criado num teste
  // não pode aparecer no seguinte.
  resetMockAccounts();

  // Alguns testes rodam no ambiente `node` (sem DOM) — daí a checagem.
  const browserWindow = globalThis.window as Window | undefined;
  if (browserWindow !== undefined) {
    browserWindow.localStorage.clear();
    // A sessão vive em `sessionStorage`: sem isto, um teste entrega a sessão
    // do anterior para o próximo.
    browserWindow.sessionStorage.clear();
    browserWindow.history.replaceState(null, '', '/');
    installMatchMediaStub();
    installScrollIntoViewStub();
  }
});

afterAll(() => {
  server.close();
});
