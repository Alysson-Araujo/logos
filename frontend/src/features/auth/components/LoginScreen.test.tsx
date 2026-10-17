import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/http';
import { createTestSession } from '@/test/auth';

import { login } from '../api';
import type { AuthSession } from '../types';
import { useAuthStore } from '../useAuthStore';
import { LoginScreen } from './LoginScreen';

/**
 * A camada HTTP é mockada aqui de propósito: este arquivo testa a **tela**, e
 * o contrato do login é verificado com a API simulada em `../api.test.ts`
 * (ambiente `node`, onde o `fetch` aceita o `AbortSignal`).
 */
vi.mock('../api', () => ({
  login: vi.fn(),
  revokeSessionToken: vi.fn(),
}));

const loginMock = vi.mocked(login);

const DEMO_EMAIL = 'ana@autou.com.br';

function renderLogin() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <LoginScreen />
    </QueryClientProvider>,
  );
}

function apiError(status: number, code: string, kind: 'http' | 'network' | 'timeout'): ApiError {
  return new ApiError({ status, code, message: 'mensagem interna do servidor', kind });
}

beforeEach(() => {
  loginMock.mockReset();
  useAuthStore.setState({ session: null, notice: null });
});

describe('LoginScreen', () => {
  it('monta o card do frame com marca, campos, ação e seletor de tema', () => {
    renderLogin();

    expect(screen.getByText('LOGOS')).toBeInTheDocument();
    expect(screen.getByText('Central de Resposta a Incidentes')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveValue(DEMO_EMAIL);
    expect(screen.getByLabelText('Senha')).toHaveValue('ana.logos2026');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tema/i })).toBeInTheDocument();
  });

  it('exibe as credenciais de demonstração exigidas na tela inicial', () => {
    renderLogin();

    expect(screen.getByText('Acesso de demonstração')).toBeInTheDocument();
    // O `getByText` normaliza espaços, então o separador tem um espaço só.
    expect(screen.getByText('ana@autou.com.br · ana.logos2026')).toBeInTheDocument();
  });

  it('guarda a sessão quando as credenciais conferem', async () => {
    const user = userEvent.setup();
    loginMock.mockResolvedValue(createTestSession());
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      expect(useAuthStore.getState().session).not.toBeNull();
    });
    expect(loginMock).toHaveBeenCalledWith({ email: DEMO_EMAIL, password: 'ana.logos2026' });
    expect(useAuthStore.getState().session?.user.role).toBe('ANALYST');
    expect(window.sessionStorage.getItem('logos-session')).not.toBeNull();
  });

  it('mostra o alerta do frame de erro quando a credencial não confere', async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(apiError(401, 'INVALID_CREDENTIALS', 'http'));
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Credenciais inválidas. Verifique e-mail e senha.');
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('não confunde falha de transporte com credencial errada', async () => {
    const user = userEvent.setup();
    loginMock.mockRejectedValue(apiError(0, 'REQUEST_TIMEOUT', 'timeout'));
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/acordando/);
  });

  it('valida antes de chamar a API e leva o foco ao campo errado', async () => {
    const user = userEvent.setup();
    renderLogin();

    const email = screen.getByLabelText('E-mail');
    await user.clear(email);
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Informe o e-mail.');
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('mostra o estado de carregando do frame com os campos desabilitados', async () => {
    const user = userEvent.setup();
    let release: (session: AuthSession) => void = () => undefined;
    loginMock.mockImplementation(
      () =>
        new Promise<AuthSession>((resolve) => {
          release = resolve;
        }),
    );
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('button', { name: /Entrando/ })).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toBeDisabled();
    expect(screen.getByLabelText('Senha')).toBeDisabled();

    // Libera a promessa para o teste não terminar com atualização pendente.
    await act(async () => {
      release(createTestSession());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(useAuthStore.getState().session).not.toBeNull();
    });
  });

  it('avisa quando a sessão anterior expirou', () => {
    useAuthStore.setState({ notice: 'Sua sessão expirou. Entre novamente.' });

    renderLogin();

    expect(screen.getByRole('alert')).toHaveTextContent('Sua sessão expirou. Entre novamente.');
  });
});
