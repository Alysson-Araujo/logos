import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_CREDENTIALS } from '@/features/auth/demo';
import { PASSWORD_CHANGED } from '@/features/auth/labels';
import { useAuthStore } from '@/features/auth/useAuthStore';
import { createTestSession } from '@/test/auth';

import { ChangePasswordDialog } from './ChangePasswordDialog';

function renderDialog(onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <ChangePasswordDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );

  return { onOpenChange };
}

beforeEach(() => {
  useAuthStore.setState({ session: createTestSession(), notice: null });
});

describe('ChangePasswordDialog', () => {
  it('recusa senha nova curta sem chamar a API', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Senha atual'), DEMO_CREDENTIALS.password);
    await user.type(screen.getByLabelText('Nova senha'), 'curta');
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'curta');
    await user.click(screen.getByRole('button', { name: /Salvar nova senha/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('12 caracteres');
    expect(screen.queryByText(PASSWORD_CHANGED)).not.toBeInTheDocument();
  });

  it('avisa quando a confirmação é diferente da nova senha', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Senha atual'), DEMO_CREDENTIALS.password);
    await user.type(screen.getByLabelText('Nova senha'), 'senha-nova-2026');
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'senha-nova-2027');
    await user.click(screen.getByRole('button', { name: /Salvar nova senha/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('As senhas não conferem.');
  });

  it('mostra a mensagem de senha atual incorreta vinda da API', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Senha atual'), 'senha-errada');
    await user.type(screen.getByLabelText('Nova senha'), 'senha-nova-2026');
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'senha-nova-2026');
    await user.click(screen.getByRole('button', { name: /Salvar nova senha/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A senha atual está incorreta.');
  });

  it('confirma a troca quando a API aceita', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Senha atual'), DEMO_CREDENTIALS.password);
    await user.type(screen.getByLabelText('Nova senha'), 'senha-nova-2026');
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'senha-nova-2026');
    await user.click(screen.getByRole('button', { name: /Salvar nova senha/ }));

    expect(await screen.findByText(PASSWORD_CHANGED)).toBeInTheDocument();
  });
});
