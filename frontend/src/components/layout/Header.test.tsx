import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from '@/features/auth/useAuthStore';
import { createTestSession } from '@/test/auth';

import { Header } from './Header';

beforeEach(() => {
  window.sessionStorage.clear();
  useAuthStore.setState({ session: null, notice: null });
});

describe('Header', () => {
  it('mostra nome e papel vindos da sessão, não um texto fixo', () => {
    useAuthStore.setState({ session: createTestSession() });

    render(<Header />);

    expect(screen.getByText('Ana Paula Ribeiro · analista')).toBeInTheDocument();
    expect(screen.getByText('AR')).toBeInTheDocument();
    expect(screen.queryByText('Alysson · analista')).not.toBeInTheDocument();
  });

  it('usa as iniciais de quem está logado', () => {
    useAuthStore.setState({
      session: createTestSession({
        user: {
          id: 'user-bruno',
          email: 'bruno@autou.com.br',
          name: 'Bruno Tavares',
          role: 'REPORTER',
          lastLoginAt: null,
        },
      }),
    });

    render(<Header />);

    expect(screen.getByText('BT')).toBeInTheDocument();
    expect(screen.getByText('Bruno Tavares · repórter')).toBeInTheDocument();
  });

  it('sair limpa a sessão e a aba', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().signIn(createTestSession());
    render(<Header />);

    await user.click(screen.getByRole('button', { name: 'Sair' }));

    expect(useAuthStore.getState().session).toBeNull();
    expect(window.sessionStorage.getItem('logos-session')).toBeNull();
  });

  it('sem sessão não oferece saída', () => {
    render(<Header />);

    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
  });
});
