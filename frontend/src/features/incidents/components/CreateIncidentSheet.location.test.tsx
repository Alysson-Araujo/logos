import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { delay, HttpResponse, http } from 'msw';
import { useCallback, useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from '@/features/auth/useAuthStore';
import { createQueryClient } from '@/lib/queryClient';
import { createTestSession } from '@/test/auth';
import { createIncidentFixture } from '@/test/factories';
import { server } from '@/test/setup';

import { CreateIncidentSheet } from './CreateIncidentSheet';

/**
 * Sugestões de local no cadastro de incidente.
 *
 * A lista vem pelo **MSW**, e não por um mock de módulo: o alvo aqui é o
 * comportamento ponta a ponta do campo — debounce, corrida de respostas e
 * teclado —, e um mock de módulo esconderia justamente o que se quer observar.
 */

const INCIDENTS_URL = '*/incidents';

interface RespostaDeLocal {
  labels: readonly string[];
  /** Atraso artificial, em milissegundos. É o que permite montar a corrida. */
  delayMs?: number;
}

/** Termos consultados, na ordem. É como os testes de cota medem o debounce. */
let consultas: string[] = [];

function montarLista(labels: readonly string[]) {
  return {
    items: labels.map((label, indice) =>
      createIncidentFixture({ id: `inc-${indice}`, locationLabel: label }),
    ),
    pageInfo: { nextCursor: null, hasNextPage: false, limit: 5 },
    meta: { total: labels.length, appliedFilters: {} },
  };
}

/**
 * Serve `GET /incidents` por termo buscado.
 *
 * O handler de `/vehicles` existe porque o mesmo formulário consulta a frota no
 * campo Placa: o `setup` do MSW roda com `onUnhandledRequest: 'error'`, e sem
 * ele o teste morreria por uma requisição que não é o que se está verificando.
 */
function serveLocations(
  porTermo: Record<string, RespostaDeLocal>,
  padrao: RespostaDeLocal = { labels: [] },
): void {
  server.use(
    http.get(INCIDENTS_URL, async ({ request }) => {
      const termo = new URL(request.url).searchParams.get('search') ?? '';
      consultas.push(termo);

      const resposta = porTermo[termo.toLowerCase()] ?? padrao;
      if (resposta.delayMs !== undefined && resposta.delayMs > 0) {
        await delay(resposta.delayMs);
      }
      return HttpResponse.json(montarLista(resposta.labels));
    }),
    http.get('*/vehicles', () => HttpResponse.json({ items: [], total: 0 })),
  );
}

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  consultas = [];
  useAuthStore.setState({ session: createTestSession(), notice: null, pendingPassword: null });
});

/** Reproduz o encaixe real: um botão da triagem que abre a sheet. */
function CreateIncidentHarness() {
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <>
      <button type="button" onClick={handleOpen}>
        Novo incidente
      </button>
      <CreateIncidentSheet open={open} onClose={handleClose} />
    </>
  );
}

function renderSheet(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <CreateIncidentHarness />
    </QueryClientProvider>,
  );
}

async function openSheet(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Novo incidente' }));
  await screen.findByRole('dialog');
  return screen.getByLabelText(/^Local/);
}

describe('sugestões de local', () => {
  it('mostra sugestões a partir de dois caracteres', async () => {
    serveLocations({ 'br-1': { labels: ['BR-116 km 412', 'BR-101 km 88'] } });
    const user = userEvent.setup();
    renderSheet();
    const campo = await openSheet(user);

    await user.type(campo, 'BR-1');

    expect(await screen.findByRole('option', { name: 'BR-116 km 412' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'BR-101 km 88' })).toBeInTheDocument();
  });

  it('não consulta com menos de dois caracteres', async () => {
    serveLocations({ b: { labels: ['BR-116 km 412'] } });
    const user = userEvent.setup();
    renderSheet();
    const campo = await openSheet(user);

    await user.type(campo, 'B');
    // Espera passar o debounce inteiro antes de concluir que nada saiu.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(consultas).toHaveLength(0);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('escolher uma sugestão preenche o campo e fecha a lista', async () => {
    serveLocations({ 'br-1': { labels: ['BR-116 km 412'] } });
    const user = userEvent.setup();
    renderSheet();
    const campo = await openSheet(user);

    await user.type(campo, 'BR-1');
    await user.click(await screen.findByRole('option', { name: 'BR-116 km 412' }));

    expect(campo).toHaveValue('BR-116 km 412');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('preserva o texto livre, mesmo com a lista aberta', async () => {
    serveLocations({ 'br-1': { labels: ['BR-116 km 412'] } });
    const user = userEvent.setup();
    renderSheet();
    const campo = await openSheet(user);

    await user.type(campo, 'BR-1');
    await screen.findByRole('option', { name: 'BR-116 km 412' });

    // Continua digitando algo que não está na lista: o valor tem que sobreviver.
    await user.type(campo, ' na altura do posto');

    expect(campo).toHaveValue('BR-1 na altura do posto');
  });

  it('não renderiza painel nenhum quando não há sugestões', async () => {
    serveLocations({}, { labels: [] });
    const user = userEvent.setup();
    renderSheet();
    const campo = await openSheet(user);

    await user.type(campo, 'ZZ-9');
    // A consulta precisa ter terminado para a asserção valer: sem esta espera,
    // o teste passaria mesmo se a lista fosse aparecer depois.
    await waitFor(() => {
      expect(consultas).toContain('ZZ-9');
    });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/nenhum/i)).not.toBeInTheDocument();
  });

  it('deduplica locais repetidos', async () => {
    serveLocations({ 'br-1': { labels: ['BR-116 km 412', 'BR-116 km 412', 'BR-101 km 88'] } });
    const user = userEvent.setup();
    renderSheet();
    const campo = await openSheet(user);

    await user.type(campo, 'BR-1');
    await screen.findByRole('option', { name: 'BR-116 km 412' });

    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('resposta antiga que chega depois não sobrescreve a nova', async () => {
    // `BR-1` responde devagar; `BR-11`, rápido. A antiga chega por último.
    serveLocations({
      'br-1': { labels: ['BR-1 LOCAL ANTIGO'], delayMs: 600 },
      'br-11': { labels: ['BR-11 LOCAL NOVO'], delayMs: 0 },
    });
    const user = userEvent.setup();
    renderSheet();
    const campo = await openSheet(user);

    await user.type(campo, 'BR-1');
    // Espera a primeira consulta SAIR de verdade: sem isto o debounce juntaria
    // as duas digitações numa consulta só, e a corrida nunca aconteceria.
    await waitFor(() => {
      expect(consultas).toContain('BR-1');
    });

    await user.type(campo, '1');
    expect(await screen.findByRole('option', { name: 'BR-11 LOCAL NOVO' })).toBeInTheDocument();

    // Dá tempo de a resposta atrasada de `BR-1` chegar.
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(screen.getByRole('option', { name: 'BR-11 LOCAL NOVO' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'BR-1 LOCAL ANTIGO' })).not.toBeInTheDocument();
  });

  it('navega por teclado e o Esc fecha sem limpar o campo', async () => {
    serveLocations({ 'br-1': { labels: ['BR-116 km 412', 'BR-101 km 88'] } });
    const user = userEvent.setup();
    renderSheet();
    const campo = await openSheet(user);

    await user.type(campo, 'BR-1');
    await screen.findByRole('option', { name: 'BR-116 km 412' });

    await user.keyboard('{ArrowDown}');
    expect(campo).toHaveAttribute('aria-activedescendant', expect.stringContaining('opcao-0'));

    await user.keyboard('{ArrowDown}');
    expect(campo).toHaveAttribute('aria-activedescendant', expect.stringContaining('opcao-1'));

    await user.keyboard('{ArrowUp}');
    expect(campo).toHaveAttribute('aria-activedescendant', expect.stringContaining('opcao-0'));

    await user.keyboard('{Enter}');
    expect(campo).toHaveValue('BR-116 km 412');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Reabre com a seta e fecha com Esc: o valor NÃO pode ser limpo.
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // Diagnóstico: a sheet continua aberta? Se isto falhar, o Esc fechou o
    // formulário inteiro em vez de apenas a lista.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(campo).toHaveValue('BR-116 km 412');
    expect(campo).toHaveFocus();
  });

  it('digitar rápido não dispara uma consulta por tecla', async () => {
    serveLocations({ 'br-116': { labels: ['BR-116 km 412'] } });
    const user = userEvent.setup();
    renderSheet();
    const campo = await openSheet(user);

    await user.type(campo, 'BR-116');
    await waitFor(() => {
      expect(consultas.length).toBeGreaterThan(0);
    });

    // Seis teclas. Sem debounce seriam seis consultas — e a cota do backend é de
    // 60 leituras por minuto por cliente.
    expect(consultas.length).toBeLessThanOrEqual(2);
    expect(consultas.at(-1)).toBe('BR-116');
  });

  it('o foco permanece no campo durante toda a navegação', async () => {
    serveLocations({ 'br-1': { labels: ['BR-116 km 412', 'BR-101 km 88'] } });
    const user = userEvent.setup();
    renderSheet();
    const campo = await openSheet(user);

    await user.type(campo, 'BR-1');
    await screen.findByRole('option', { name: 'BR-116 km 412' });
    await user.keyboard('{ArrowDown}');

    expect(campo).toHaveFocus();
  });
});
