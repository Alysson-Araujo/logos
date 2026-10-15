import { setupWorker } from 'msw/browser';

import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

/**
 * Sobe a API simulada no navegador. O service worker fica em
 * `public/mockServiceWorker.js` (gerado por `pnpm msw:init`).
 */
export async function startMockWorker(): Promise<void> {
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
  });
  console.warn(
    '[Logos] API simulada (MSW) ativa — defina VITE_USE_MOCK=false para usar a API real.',
  );
}
