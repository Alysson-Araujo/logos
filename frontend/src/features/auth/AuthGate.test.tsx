import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestSession } from '@/test/auth';

import { AuthGate } from './AuthGate';
import { useAuthStore } from './useAuthStore';

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <p>triagem montada</p>
      </AuthGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  useAuthStore.setState({ session: null, notice: null });
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
});
