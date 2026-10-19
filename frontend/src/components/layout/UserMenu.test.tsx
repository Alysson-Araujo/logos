import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from '@/features/auth/useAuthStore';
import { createAdminSession, createTestSession } from '@/test/auth';

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
  window.history.replaceState(null, '', '/');
  useAuthStore.setState({ session: null, notice: null, pendingPassword: null });
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
    expect(screen.getByText('ana@demo.example.com')).toBeInTheDocument();
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

  /*
   * O menu é o **único** ponto de entrada da administração de contas (#128): se
   * o item não existir para `ADMIN`, a tela é inalcançável pela interface.
   */
  it('oferece "Contas de acesso" para ADMIN, junto do logoff', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ session: createAdminSession() });
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Abrir menu do usuário' }));

    expect(await screen.findByRole('menuitem', { name: /Contas de acesso/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Sair/ })).toBeInTheDocument();
  });

  it('não oferece a administração para quem não é ADMIN', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ session: createTestSession() });
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Abrir menu do usuário' }));

    expect(await screen.findByRole('menuitem', { name: /Sair/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Contas de acesso/ })).not.toBeInTheDocument();
  });

  it('leva para ?view=contas preservando os filtros da triagem', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/?status=ABERTO&criticality=ALTA');
    useAuthStore.setState({ session: createAdminSession() });
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Abrir menu do usuário' }));
    await user.click(await screen.findByRole('menuitem', { name: /Contas de acesso/ }));

    const params = new URLSearchParams(window.location.search);
    expect(params.get('view')).toBe('contas');
    expect(params.get('status')).toBe('ABERTO');
    expect(params.get('criticality')).toBe('ALTA');
  });
});
