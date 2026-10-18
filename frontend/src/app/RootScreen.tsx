import { App } from './App';
import { useAppView } from './useAppView';

import { AccountsScreen } from '@/features/accounts/components/AccountsScreen';

/**
 * Escolhe a tela a partir da URL (`?view=contas` → administração de contas).
 *
 * O `App` é a triagem e continua intocado: a troca é de componente, e não de
 * rota, porque o app não tem roteador. Cada tela monta o seu próprio
 * `AppShell`, então o header (e o menu do usuário) é o mesmo nas duas.
 */
export function RootScreen() {
  const { view } = useAppView();

  return view === 'contas' ? <AccountsScreen /> : <App />;
}
