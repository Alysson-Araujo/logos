import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { RootScreen } from './app/RootScreen';
import { AppProviders } from './app/providers';
import { AuthGate } from './features/auth/AuthGate';
import { wireAuthSession } from './features/auth/session';
import './styles/globals.css';

/**
 * Regra do mock: `VITE_USE_MOCK=false` desliga; `true` liga em qualquer build;
 * sem a variável, o modo de desenvolvimento sobe com a API simulada.
 *
 * O padrão de desenvolvimento é o mock para a tela nunca ficar em branco sem o
 * backend. O efeito colateral, porém, era caro: convidar alguém não enviava
 * e-mail nenhum, porque a requisição nunca saía do navegador — e a tela dizia
 * "Convite enviado" do mesmo jeito. Por isso a faixa do `MockApiBanner`: o
 * recurso continua disponível, mas agora se anuncia.
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

// Liga o cliente HTTP à sessão antes de qualquer render: a triagem dispara
// consultas no primeiro efeito que rodar, e elas já precisam do token.
wireAuthSession();

void enableMocking()
  .then(() => {
    createRoot(rootElement).render(
      <StrictMode>
        <AppProviders>
          <AuthGate>
            <RootScreen />
          </AuthGate>
        </AppProviders>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error('Falha ao iniciar a aplicação Logos.', error);
  });
