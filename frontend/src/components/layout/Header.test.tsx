import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { LOGIN_SIGNED_OUT } from '@/features/auth/labels';
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
          email: 'bruno@demo.example.com',
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

  it('a área do usuário abre o menu com a saída dentro', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ session: createTestSession() });
    render(<Header />);

    // O botão solto de "Sair" saiu do cabeçalho: agora ele vive no menu.
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abrir menu do usuário' }));

    expect(await screen.findByRole('menuitem', { name: /Sair/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Trocar senha/ })).toBeInTheDocument();
  });

  it('sair pelo menu limpa a sessão, a aba e deixa o aviso para o login', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().signIn(createTestSession());
    render(<Header />);

    await user.click(screen.getByRole('button', { name: 'Abrir menu do usuário' }));
    await user.click(await screen.findByRole('menuitem', { name: /Sair/ }));

    expect(useAuthStore.getState().session).toBeNull();
    expect(window.sessionStorage.getItem('logos-session')).toBeNull();
    expect(useAuthStore.getState().notice).toBe(LOGIN_SIGNED_OUT);
  });

  it('sem sessão não oferece menu de usuário', () => {
    render(<Header />);

    expect(screen.queryByRole('button', { name: 'Abrir menu do usuário' })).not.toBeInTheDocument();
  });

  it('o botão Guia tem texto visível, ícone de livro e fica à esquerda do "ao vivo"', () => {
    render(<Header />);

    const guide = screen.getByRole('button', { name: 'Abrir o guia' });
    expect(guide).toHaveAttribute('title', 'Abrir o guia');
    // Texto visível "Guia" (o ícone não tem texto), e o nome acessível contém esse texto.
    expect(guide.textContent).toBe('Guia');
    expect(guide.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    const connection = screen.getByText('ao vivo').closest('[data-tour="connection"]');
    if (connection === null) throw new Error('indicador ao vivo ausente');
    // Mesmo grupo da direita, logo antes do indicador de conexão.
    expect(guide.parentElement).toBe(connection.parentElement);
    expect(guide.compareDocumentPosition(connection)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
