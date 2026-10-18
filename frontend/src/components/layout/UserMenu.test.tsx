import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from '@/features/auth/useAuthStore';
import { createTestSession } from '@/test/auth';

import { UserMenu } from './UserMenu';

/**
 * O menu precisa do `QueryClient` só quando a troca de senha abre — é o único
 * caminho que usa mutação. O provedor entra aqui porque é assim que o app
 * monta a árvore (`AppProviders`).
 */
function renderMenu() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <UserMenu />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  useAuthStore.setState({ session: null, notice: null });
});

describe('UserMenu', () => {
  it('não renderiza nada sem sessão', () => {
    renderMenu();

    expect(screen.queryByRole('button', { name: 'Abrir menu do usuário' })).not.toBeInTheDocument();
  });

  it('abre com nome, e-mail e as duas ações', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ session: createTestSession() });
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Abrir menu do usuário' }));

    expect(await screen.findByText('Ana Paula Ribeiro')).toBeInTheDocument();
    expect(screen.getByText('ana@autou.com.br')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Trocar senha/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Sair/ })).toBeInTheDocument();
  });

  it('"Trocar senha" abre o formulário de troca', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ session: createTestSession() });
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Abrir menu do usuário' }));
    await user.click(await screen.findByRole('menuitem', { name: /Trocar senha/ }));

    expect(await screen.findByLabelText('Senha atual')).toBeInTheDocument();
  });
});
