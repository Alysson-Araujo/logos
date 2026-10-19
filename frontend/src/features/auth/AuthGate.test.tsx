import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AccountsScreen } from '@/features/accounts/components/AccountsScreen';
import { configureAuth } from '@/lib/http';
import { createAdminSession, createTestSession } from '@/test/auth';
import { server } from '@/test/setup';

import { AuthGate } from './AuthGate';
import { wireAuthSession } from './session';
import { useAuthStore } from './useAuthStore';

function renderGate(children = <p>triagem montada</p>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <AuthGate>{children}</AuthGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  useAuthStore.setState({ session: null, notice: null, pendingPassword: null });
});

afterEach(() => {
  configureAuth(null);
});

describe('AuthGate', () => {
  it('sem sessão, mostra o login e não monta a triagem', () => {
    renderGate();

    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.queryByText('triagem montada')).not.toBeInTheDocument();
  });

  it('com sessão, monta a aplicação e nenhum campo de login', () => {
    useAuthStore.setState({ session: createTestSession() });

    renderGate();

    expect(screen.getByText('triagem montada')).toBeInTheDocument();
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
  });

  it('volta ao login quando a sessão é encerrada', () => {
    useAuthStore.setState({ session: createTestSession() });
    const { rerender } = renderGate();

    useAuthStore.getState().signOut('expired');

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <AuthGate>
          <p>triagem montada</p>
        </AuthGate>
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Sua sessão expirou. Entre novamente.');
  });

  /**
   * Primeiro acesso (issue #128): `mustChangePassword: true` no login troca a
   * triagem pela tela de definir senha — e só depois de salvar ela volta.
   */
  it('mustChangePassword no login leva à tela de senha e bloqueia a triagem', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('*/auth/login', () =>
        HttpResponse.json({
          accessToken: 'mock-token-primeiro-acesso',
          tokenType: 'Bearer',
          expiresIn: 28_800,
          mustChangePassword: true,
          user: {
            id: 'user-nova',
            email: 'joana.prado@demo.example.com',
            name: 'Joana Prado',
            role: 'ANALYST',
            lastLoginAt: null,
          },
        }),
      ),
    );

    renderGate();

    // O formulário de login já vem preenchido com a credencial de demonstração.
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(
      await screen.findByText('Defina a senha definitiva para continuar.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('triagem montada')).not.toBeInTheDocument();
    expect(useAuthStore.getState().session?.mustChangePassword).toBe(true);

    await user.type(screen.getByLabelText('Nova senha'), 'senha-definitiva-2026');
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'senha-definitiva-2026');
    await user.click(screen.getByRole('button', { name: /salvar e entrar/i }));

    expect(await screen.findByText('triagem montada')).toBeInTheDocument();
    expect(useAuthStore.getState().session?.mustChangePassword).toBe(false);
    // A temporária sai da memória assim que deixa de valer.
    expect(useAuthStore.getState().pendingPassword).toBeNull();
  });

  /**
   * A mesma porta pelo outro lado: qualquer rota comum pode revelar que a
   * sessão ainda usa a senha temporária (`403 PASSWORD_CHANGE_REQUIRED`).
   */
  it('403 PASSWORD_CHANGE_REQUIRED vindo de uma rota comum leva à tela de senha', async () => {
    wireAuthSession();
    useAuthStore.setState({ session: createAdminSession() });

    server.use(
      http.get('*/users', () =>
        HttpResponse.json(
          {
            error: {
              code: 'PASSWORD_CHANGE_REQUIRED',
              message: 'Defina sua senha para liberar o acesso.',
              details: null,
              requestId: 'req-de-teste',
              timestamp: new Date().toISOString(),
            },
          },
          { status: 403 },
        ),
      ),
    );

    renderGate(<AccountsScreen />);

    expect(
      await screen.findByText('Defina a senha definitiva para continuar.'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(useAuthStore.getState().session?.mustChangePassword).toBe(true);
    });
    // A administração de contas não fica montada por baixo da tela de senha.
    expect(screen.queryByText('Contas de acesso')).not.toBeInTheDocument();
  });

  it('mostra a tela de senha mesmo sem a temporária em memória (aba recarregada)', () => {
    useAuthStore.setState({
      session: createTestSession({ mustChangePassword: true }),
      pendingPassword: null,
    });

    renderGate();

    expect(screen.getByText('Defina a senha definitiva para continuar.')).toBeInTheDocument();
    // Sem a senha atual não há como chamar a API: a saída é entrar de novo.
    expect(screen.getByText(/A senha temporária não está mais nesta aba/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sair e entrar de novo/i })).toBeInTheDocument();
  });

  it('sair da tela de senha limpa a sessão e volta ao login', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({
      session: createTestSession({ mustChangePassword: true }),
      pendingPassword: null,
    });

    renderGate();
    await user.click(screen.getByRole('button', { name: /sair e entrar de novo/i }));

    expect(useAuthStore.getState().session).toBeNull();
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
  });

  it('persiste o estado de primeiro acesso sem guardar a senha temporária', () => {
    useAuthStore
      .getState()
      .signIn(createTestSession({ mustChangePassword: true }), 'kQ7mPx4R9tD2wZ8n');

    const stored = window.sessionStorage.getItem('logos-session');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? 'null')).toMatchObject({ mustChangePassword: true });
    // A temporária vive só em memória: nem o `sessionStorage` a vê.
    expect(stored).not.toContain('kQ7mPx4R9tD2wZ8n');
  });
});
