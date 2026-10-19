import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from '@/features/auth/useAuthStore';
import type { AuthSession } from '@/features/auth/types';
import { createQueryClient } from '@/lib/queryClient';
import { createAdminSession, createTestSession } from '@/test/auth';
import { createAccountFixtures } from '@/test/factories';
import { server } from '@/test/setup';

import type { AccountSummary } from '../types';
import { AccountsScreen } from './AccountsScreen';

const NEW_EMAIL = 'novo.analista@parceiro.com.br';

/** Lista controlada pelo teste: as quatro contas do frame, em ordem. */
function serveAccounts(accounts: readonly AccountSummary[] = createAccountFixtures()): void {
  server.use(http.get('*/users', () => HttpResponse.json(accounts)));
}

function apiErrorResponse(status: number, code: string, message: string, details?: unknown) {
  return HttpResponse.json(
    {
      error: {
        code,
        message,
        details: details ?? null,
        requestId: 'req-de-teste',
        timestamp: new Date().toISOString(),
      },
    },
    { status },
  );
}

function renderScreen(session: AuthSession = createAdminSession()) {
  useAuthStore.setState({ session, notice: null, pendingPassword: null });

  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AccountsScreen />
    </QueryClientProvider>,
  );
}

/**
 * Abre o painel de nova conta e devolve o próprio painel.
 *
 * As consultas dos testes de criação ficam escopadas nele: a barra de filtros
 * da lista também tem um campo com "e-mail" no rótulo ("Buscar por nome ou
 * e-mail"), e o `getByLabelText` global acharia os dois.
 */
async function openCreateSheet(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /nova conta/i }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  useAuthStore.setState({ session: null, notice: null, pendingPassword: null });
});

describe('AccountsScreen — tabela', () => {
  it('renderiza as 4 contas nas colunas e o selo segue invitePending/isActive', async () => {
    serveAccounts();
    renderScreen();

    await screen.findByText('Joana Prado');

    // A mesma tabela é lida como grade na mesa e como blocos no celular, por
    // CSS. As consultas ficam escopadas nela para não colidir com outros textos
    // da tela que repetem nomes ou contagens.
    const tabela = screen.getByRole('table');

    expect(within(tabela).getAllByRole('row')).toHaveLength(5);
    for (const label of ['Pessoa', 'Papel', 'Situação', 'Último acesso', 'Ações']) {
      expect(within(tabela).getByRole('columnheader', { name: label })).toBeInTheDocument();
    }

    const joana = within(tabela).getByRole('row', { name: /joana prado/i });
    expect(within(joana).getByText('joana.prado@demo.example.com')).toBeInTheDocument();
    expect(within(joana).getByText('REPORTER')).toBeInTheDocument();
    // Convite pendente vence "desativado": é o estado que pede ação.
    expect(within(joana).getByText('Convite pendente')).toBeInTheDocument();

    const ana = within(tabela).getByRole('row', { name: /ana paula ribeiro/i });
    expect(within(ana).getByText('ADMIN')).toBeInTheDocument();
    expect(within(ana).getByText('Ativo')).toBeInTheDocument();

    const bruno = within(tabela).getByRole('row', { name: /bruno tavares/i });
    expect(within(bruno).getByText('ANALYST')).toBeInTheDocument();
    expect(within(bruno).getByText('Ativo')).toBeInTheDocument();

    const carla = within(tabela).getByRole('row', { name: /carla mendes/i });
    expect(within(carla).getByText('Desativado')).toBeInTheDocument();

    // O resumo aparece no cabeçalho da lista e no da tabela; qualquer um serve.
    expect(screen.getAllByText('4 contas · 1 convite pendente').length).toBeGreaterThan(0);
  });

  it('mostra "—" no último acesso quando lastLoginAt é null', async () => {
    serveAccounts();
    renderScreen();

    const joana = await screen.findByRole('row', { name: /joana prado/i });
    expect(within(joana).getAllByRole('cell')[3]?.textContent).toBe('—');

    // Quem entrou hoje e ontem aparece por extenso, como no frame.
    const ana = screen.getByRole('row', { name: /ana paula ribeiro/i });
    expect(within(ana).getAllByRole('cell')[3]?.textContent).toMatch(/^hoje, \d{2}:\d{2}$/);

    const bruno = screen.getByRole('row', { name: /bruno tavares/i });
    expect(within(bruno).getAllByRole('cell')[3]?.textContent).toMatch(/^ontem, \d{2}:\d{2}$/);

    const carla = screen.getByRole('row', { name: /carla mendes/i });
    expect(within(carla).getAllByRole('cell')[3]?.textContent).toBe('12 dias atrás');
  });

  it('oferece "Reenviar" apenas na linha com convite pendente', async () => {
    serveAccounts();
    renderScreen();

    await screen.findByText('Joana Prado');

    const resendButtons = screen.getAllByRole('button', { name: /reenviar o convite/i });
    expect(resendButtons).toHaveLength(1);

    const joana = screen.getByRole('row', { name: /joana prado/i });
    expect(within(joana).getByRole('button', { name: /reenviar o convite/i })).toBeInTheDocument();
    expect(
      within(joana).queryByRole('button', { name: /conta de joana/i }),
    ).not.toBeInTheDocument();

    const ana = screen.getByRole('row', { name: /ana paula ribeiro/i });
    expect(within(ana).getByRole('button', { name: /desativar a conta/i })).toBeInTheDocument();

    const carla = screen.getByRole('row', { name: /carla mendes/i });
    expect(within(carla).getByRole('button', { name: /reativar a conta/i })).toBeInTheDocument();
  });

  it('mostra o esqueleto de linhas enquanto a lista carrega', () => {
    serveAccounts();
    renderScreen();

    expect(screen.getByTestId('accounts-skeleton')).toBeInTheDocument();
    expect(screen.getByText('Carregando contas…')).toBeInTheDocument();
  });

  it('mostra o vazio quando não há nenhuma conta', async () => {
    serveAccounts([]);
    renderScreen();

    expect(await screen.findByTestId('accounts-empty-initial')).toHaveTextContent(
      'Nenhuma conta cadastrada ainda',
    );
  });

  it('mostra o vazio filtrado quando a busca não acha ninguém', async () => {
    const user = userEvent.setup();
    serveAccounts();
    renderScreen();

    await screen.findByText('Joana Prado');
    await user.type(screen.getByRole('searchbox', { name: /buscar por nome ou e-mail/i }), 'zzz');

    expect(await screen.findByTestId('accounts-empty-filtered')).toBeInTheDocument();
    expect(screen.getByText('0 contas · 0 convites pendentes')).toBeInTheDocument();
  });

  it('mostra o estado de erro sem derrubar a tela (400 não é repetido)', async () => {
    server.use(
      http.get('*/users', () =>
        apiErrorResponse(400, 'BAD_REQUEST', 'Requisição recusada pela API.'),
      ),
    );
    renderScreen();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as contas',
    );
  });

  it('sem ADMIN mostra a mensagem de permissão e não lista de novo', async () => {
    let requests = 0;
    server.use(
      http.get('*/users', () => {
        requests += 1;
        return apiErrorResponse(
          403,
          'INSUFFICIENT_ROLE',
          'Seu perfil não tem permissão para esta ação.',
        );
      }),
    );
    renderScreen(createTestSession());

    const permission = await screen.findByTestId('accounts-permission');
    expect(permission).toHaveTextContent(/exige o papel ADMIN/i);
    // Sem "Tentar novamente": o papel não muda por insistir.
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).not.toBeInTheDocument();

    // O cliente HTTP repetiria 5xx em 1s/2s/4s; um 403 não pode gerar nenhuma
    // tentativa nova. Esperar além dessa janela é o que prova a ausência.
    await new Promise((resolve) => {
      setTimeout(resolve, 1_200);
    });
    expect(requests).toBe(1);
  });
});

describe('AccountsScreen — nova conta', () => {
  it('envia e-mail e papel para POST /users e mostra o alerta verde', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    serveAccounts();

    server.use(
      http.post('*/users', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          {
            id: 'conta-nova',
            email: NEW_EMAIL,
            role: 'ANALYST',
            inviteExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    renderScreen();
    const sheet = await openCreateSheet();

    await user.type(within(sheet).getByLabelText(/e-mail/i), NEW_EMAIL);
    await user.click(within(sheet).getByLabelText(/papel/i));
    await user.click(
      await screen.findByRole('option', { name: 'ANALYST · conduz o ciclo e resolve' }),
    );
    await user.click(within(sheet).getByRole('button', { name: /enviar convite/i }));

    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    // Corpo exato do contrato: sem nome (o servidor deriva do e-mail) e sem
    // senha (a temporária sai por e-mail, nunca na resposta).
    expect(bodies[0]).toEqual({ email: NEW_EMAIL, role: 'ANALYST' });

    const alert = await screen.findByTestId('invite-sent-alert');
    expect(alert).toHaveTextContent(`Convite enviado para ${NEW_EMAIL}.`);
    expect(alert).toHaveTextContent('expira em 24 horas');
    expect(alert).toHaveTextContent('pendente até o primeiro acesso');
  });

  it('mostra o 409 no campo de e-mail, e não como erro genérico', async () => {
    const user = userEvent.setup();
    serveAccounts();
    server.use(
      http.post('*/users', () =>
        apiErrorResponse(409, 'EMAIL_ALREADY_EXISTS', 'Já existe uma conta com este e-mail.', {
          email: NEW_EMAIL,
        }),
      ),
    );

    renderScreen();
    const sheet = await openCreateSheet();

    const email = within(sheet).getByLabelText(/e-mail/i);
    await user.type(email, NEW_EMAIL);
    await user.click(within(sheet).getByRole('button', { name: /enviar convite/i }));

    const message = await screen.findByText('Já existe uma conta com este e-mail.');
    expect(message).toHaveAttribute('id', 'conta-email-erro');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email.getAttribute('aria-describedby')).toContain('conta-email-erro');
    expect(document.getElementById('conta-form-erro')).toBeNull();
  });

  it('conta criada com e-mail não entregue: fecha o painel e manda reenviar', async () => {
    // O `409 INVITE_DELIVERY_FAILED` é o caso que se perdia em silêncio: a conta
    // nasce no banco, o SMTP recusa e o administrador achava que estava tudo bem.
    // Aqui a tela precisa ser honesta sobre as duas metades.
    const user = userEvent.setup();
    serveAccounts();
    server.use(
      http.post('*/users', () =>
        apiErrorResponse(
          409,
          'INVITE_DELIVERY_FAILED',
          'A conta foi criada, mas o e-mail do convite não pôde ser enviado.',
          { email: NEW_EMAIL },
        ),
      ),
    );

    renderScreen();
    const sheet = await openCreateSheet();

    await user.type(within(sheet).getByLabelText(/e-mail/i), NEW_EMAIL);
    await user.click(within(sheet).getByRole('button', { name: /enviar convite/i }));

    const alerta = await screen.findByTestId('invite-delivery-failed-alert');
    expect(alerta).toHaveAttribute('role', 'alert');
    expect(alerta).toHaveTextContent(NEW_EMAIL);
    expect(alerta).toHaveTextContent(/o e-mail do convite não saiu/i);
    expect(alerta).toHaveTextContent(/Reenviar convite/i);

    // Nada de "Convite enviado" — é justamente o que era mentira antes.
    expect(screen.queryByTestId('invite-sent-alert')).toBeNull();
    // O painel fecha: deixá-lo aberto convidaria a repetir o envio, que bateria
    // em EMAIL_ALREADY_EXISTS porque a conta já existe.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('mostra o 422 da API no campo que ela apontou', async () => {
    const user = userEvent.setup();
    serveAccounts();
    server.use(
      http.post('*/users', () =>
        apiErrorResponse(422, 'VALIDATION_ERROR', 'A requisição contém dados inválidos.', {
          validationErrors: [
            { loc: ['body', 'email'], msg: 'Informe um e-mail válido.', type: 'value_error' },
          ],
        }),
      ),
    );

    renderScreen();
    const sheet = await openCreateSheet();

    const email = within(sheet).getByLabelText(/e-mail/i);
    await user.type(email, NEW_EMAIL);
    await user.click(within(sheet).getByRole('button', { name: /enviar convite/i }));

    expect(await screen.findByText('Informe um e-mail válido.')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
  });

  it('valida o formato do e-mail antes de chamar a API', async () => {
    const user = userEvent.setup();
    let requests = 0;
    serveAccounts();
    server.use(
      http.post('*/users', () => {
        requests += 1;
        return apiErrorResponse(500, 'INTERNAL_ERROR', 'não deveria chegar aqui');
      }),
    );

    renderScreen();
    const sheet = await openCreateSheet();

    await user.type(within(sheet).getByLabelText(/e-mail/i), 'sem-arroba');
    await user.click(within(sheet).getByRole('button', { name: /enviar convite/i }));

    expect(await screen.findByText('Informe um e-mail válido.')).toBeInTheDocument();
    expect(requests).toBe(0);
  });

  it('não restringe o domínio do e-mail (qualquer endereço válido serve)', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    serveAccounts();
    server.use(
      http.post('*/users', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          {
            id: 'conta-parceiro',
            email: 'pessoa@parceiro.com',
            role: 'REPORTER',
            inviteExpiresAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    renderScreen();
    const sheet = await openCreateSheet();

    await user.type(within(sheet).getByLabelText(/e-mail/i), 'pessoa@parceiro.com');
    await user.click(within(sheet).getByRole('button', { name: /enviar convite/i }));

    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).toEqual({ email: 'pessoa@parceiro.com', role: 'REPORTER' });
  });

  it('cancela sem enviar nada e limpa o formulário ao reabrir', async () => {
    const user = userEvent.setup();
    serveAccounts();
    renderScreen();

    const sheet = await openCreateSheet();
    await user.type(within(sheet).getByLabelText(/e-mail/i), 'rascunho@demo.example.com');
    await user.click(within(sheet).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const reopened = await openCreateSheet();
    expect(within(reopened).getByLabelText(/e-mail/i)).toHaveValue('');
    // O formulário abre no papel padrão do frame (`REPORTER`).
    expect(within(reopened).getByLabelText(/papel/i)).toHaveTextContent('REPORTER');
  });
});
