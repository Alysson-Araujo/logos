import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTestSession } from '@/test/auth';
import { server } from '@/test/setup';

import { useAuthStore } from '../useAuthStore';
import { ChangePasswordScreen } from './ChangePasswordScreen';

const TEMPORARY_PASSWORD = 'kQ7mPx4R9tD2wZ8n';
const DEFINITIVE_PASSWORD = 'definitiva-2026-logos';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <ChangePasswordScreen />
    </QueryClientProvider>,
  );
}

/** Conta as chamadas de `POST /auth/change-password` e responde o que o teste pedir. */
function countPasswordChanges(response: () => Response): () => number {
  let requests = 0;
  server.use(
    http.post('*/auth/change-password', () => {
      requests += 1;
      return response();
    }),
  );
  return () => requests;
}

beforeEach(() => {
  useAuthStore.setState({
    session: createTestSession({ mustChangePassword: true }),
    notice: null,
    pendingPassword: TEMPORARY_PASSWORD,
  });
});

describe('ChangePasswordScreen', () => {
  it('monta o card do frame com as duas senhas e a política', () => {
    renderScreen();

    expect(screen.getByText('LOGOS')).toBeInTheDocument();
    expect(screen.getByText('Defina a senha definitiva para continuar.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nova senha')).toBeInTheDocument();
    expect(screen.getByText('A temporária deixa de valer ao salvar.')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirmar nova senha')).toBeInTheDocument();
    expect(screen.getByText('POLÍTICA DE SENHA')).toBeInTheDocument();
    expect(screen.getByText('Mínimo de 12 caracteres.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /salvar e entrar/i })).toBeInTheDocument();
  });

  it('não chama a API quando a nova senha tem menos de 12 caracteres', async () => {
    const user = userEvent.setup();
    const requests = countPasswordChanges(() => new HttpResponse(null, { status: 204 }));

    renderScreen();

    await user.type(screen.getByLabelText('Nova senha'), 'curta12345');
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'curta12345');
    await user.click(screen.getByRole('button', { name: /salvar e entrar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A senha deve ter ao menos 12 caracteres.',
    );
    expect(requests()).toBe(0);
    expect(useAuthStore.getState().session?.mustChangePassword).toBe(true);
  });

  it('não chama a API quando a confirmação não confere', async () => {
    const user = userEvent.setup();
    const requests = countPasswordChanges(() => new HttpResponse(null, { status: 204 }));

    renderScreen();

    await user.type(screen.getByLabelText('Nova senha'), DEFINITIVE_PASSWORD);
    await user.type(screen.getByLabelText('Confirmar nova senha'), `${DEFINITIVE_PASSWORD}x`);
    await user.click(screen.getByRole('button', { name: /salvar e entrar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('As senhas não conferem.');
    expect(requests()).toBe(0);
  });

  it('envia a temporária como senha atual e libera a sessão no sucesso', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.post('*/auth/change-password', async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderScreen();

    await user.type(screen.getByLabelText('Nova senha'), DEFINITIVE_PASSWORD);
    await user.type(screen.getByLabelText('Confirmar nova senha'), DEFINITIVE_PASSWORD);
    await user.click(screen.getByRole('button', { name: /salvar e entrar/i }));

    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toEqual({
      currentPassword: TEMPORARY_PASSWORD,
      newPassword: DEFINITIVE_PASSWORD,
    });

    await waitFor(() => {
      expect(useAuthStore.getState().session?.mustChangePassword).toBe(false);
    });
    expect(useAuthStore.getState().pendingPassword).toBeNull();
  });

  it('traduz a recusa da API sem vazar a mensagem interna', async () => {
    const user = userEvent.setup();
    countPasswordChanges(() =>
      HttpResponse.json(
        {
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'A senha atual está incorreta.',
            details: null,
            requestId: 'req-de-teste',
            timestamp: new Date().toISOString(),
          },
        },
        { status: 401 },
      ),
    );

    renderScreen();

    await user.type(screen.getByLabelText('Nova senha'), DEFINITIVE_PASSWORD);
    await user.type(screen.getByLabelText('Confirmar nova senha'), DEFINITIVE_PASSWORD);
    await user.click(screen.getByRole('button', { name: /salvar e entrar/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A senha temporária não confere ou já expirou.');
    expect(useAuthStore.getState().session?.mustChangePassword).toBe(true);
  });

  it('mostra o mínimo exigido quando a API recusa a senha (WEAK_PASSWORD)', async () => {
    const user = userEvent.setup();
    countPasswordChanges(() =>
      HttpResponse.json(
        {
          error: {
            code: 'WEAK_PASSWORD',
            message: 'A senha não atende à política mínima.',
            details: { minLength: 12, received: 12 },
            requestId: 'req-de-teste',
            timestamp: new Date().toISOString(),
          },
        },
        { status: 422 },
      ),
    );

    renderScreen();

    await user.type(screen.getByLabelText('Nova senha'), '123456789012');
    await user.type(screen.getByLabelText('Confirmar nova senha'), '123456789012');
    await user.click(screen.getByRole('button', { name: /salvar e entrar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A senha deve ter ao menos 12 caracteres.',
    );
  });
});
