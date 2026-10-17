import type { PropsWithChildren } from 'react';

import { LoginScreen } from './components/LoginScreen';
import { useAuthStore } from './useAuthStore';

/**
 * Porta de entrada da aplicação.
 *
 * Sem sessão, a triagem não é sequer montada: nenhuma consulta sai antes de
 * existir token. A troca de tela é condicional ao estado da sessão — não há
 * router, e duas telas mutuamente exclusivas não justificam um.
 */
export function AuthGate({ children }: PropsWithChildren) {
  const session = useAuthStore((state) => state.session);

  if (session === null) return <LoginScreen />;

  return <>{children}</>;
}
