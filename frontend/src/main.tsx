import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { AppProviders } from './app/providers';
import './styles/globals.css';

/**
 * Regra do mock: `VITE_USE_MOCK=false` desliga; `true` liga em qualquer build;
 * sem a variável, o modo de desenvolvimento sobe com a API simulada para que
 * a tela nunca fique em branco quando o backend não está no ar.
 */
function shouldUseMockApi(): boolean {
  const flag = import.meta.env.VITE_USE_MOCK;
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  return import.meta.env.DEV;
}

async function enableMocking(): Promise<void> {
  if (!shouldUseMockApi()) return;
  const { startMockWorker } = await import('./test/msw/browser');
  await startMockWorker();
}

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Elemento #root não encontrado no index.html.');
}

void enableMocking()
  .then(() => {
    createRoot(rootElement).render(
      <StrictMode>
        <AppProviders>
          <App />
        </AppProviders>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error('Falha ao iniciar a aplicação Logos.', error);
  });
