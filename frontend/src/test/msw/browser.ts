import { setupWorker } from 'msw/browser';

import { markMockApiActive } from '@/lib/mockApiStatus';

import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

/**
 * Sobe a API simulada no navegador. O service worker fica em
 * `public/mockServiceWorker.js` (gerado por `pnpm msw:init`).
 *
 * Marca a flag lida por `MockApiBanner`. Com o mock no ar, **nenhum convite sai
 * por e-mail**: a conta é criada dentro do navegador e a tela confirma o envio.
 *
 * Foi exatamente o que aconteceu: o convite "não chegava" porque o
 * desenvolvimento subia com o mock, `VITE_USE_MOCK` nunca foi definida e o
 * padrão em `pnpm dev` é simular. A tela dizia "Convite enviado" para um e-mail
 * que nunca existiu fora da aba.
 */
export async function startMockWorker(): Promise<void> {
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
  });
  markMockApiActive();
  console.warn(
    '[Logos] API simulada (MSW) ativa — os convites NÃO saem por e-mail. ' +
      'Defina VITE_USE_MOCK=false em frontend/.env para usar a API real.',
  );
}
