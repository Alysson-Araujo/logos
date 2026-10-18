import type { PropsWithChildren } from 'react';

import { ChangePasswordScreen } from './components/ChangePasswordScreen';
import { LoginScreen } from './components/LoginScreen';
import { useAuthStore } from './useAuthStore';

/**
 * Porta de entrada da aplicação.
 *
 * Sem sessão, a triagem não é sequer montada: nenhuma consulta sai antes de
 * existir token. A troca de tela é condicional ao estado da sessão — não há
 * router, e duas telas mutuamente exclusivas não justificam um.
 *
 * O primeiro acesso é o mesmo caso com outro degrau: enquanto a API só aceitar
 * `change-password`, a triagem continua desmontada. Não é modal porque não é
 * uma sugestão — a pessoa não pode usar o resto antes de definir a senha.
 */
export function AuthGate({ children }: PropsWithChildren) {
  const session = useAuthStore((state) => state.session);

  if (session === null) return <LoginScreen />;
  if (session.mustChangePassword) return <ChangePasswordScreen />;

  return <>{children}</>;
}
