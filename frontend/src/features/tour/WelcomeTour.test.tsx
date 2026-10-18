import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Header } from '@/components/layout/Header';
import { useAuthStore } from '@/features/auth/useAuthStore';

import { type TourTarget } from './steps';
import { computeCardLayout, computeHole, TOUR_STORAGE_KEY, useTourStore } from './useTour';
import { WelcomeTour } from './WelcomeTour';

/**
 * Alvos que a triagem marca. Tema e conexão ficam de fora da lista porque quem
 * os marca é o `Header`, que entra em todos os cenários abaixo — ou seja, os
 * dois **sempre** existem, mesmo quando a triagem não renderizou nada.
 */
const TRIAGE_TARGETS: readonly TourTarget[] = ['kpis', 'filters', 'list', 'create'];

/** Triagem de mentira: só as áreas que o guia procura no DOM. */
function TriageStub({ targets }: { targets: readonly TourTarget[] }) {
  return (
    <>
      {targets.map((target) => (
        <section key={target} data-tour={target} aria-label={`Área ${target}`} />
      ))}
    </>
  );
}

interface RenderOptions {
  targets?: readonly TourTarget[];
  ready?: boolean;
}

function renderTriage({ targets = TRIAGE_TARGETS, ready = true }: RenderOptions = {}) {
  return render(
    <>
      <Header />
      <TriageStub targets={targets} />
      <WelcomeTour ready={ready} />
    </>,
  );
}

async function flushAutoOpen(): Promise<void> {
  // O tour espera 50 ms entre tentativas: dois ciclos bastam para provar que
  // ele **não** abriu.
  await new Promise((resolve) => setTimeout(resolve, 120));
}

beforeEach(() => {
  window.localStorage.clear();
  useAuthStore.setState({ session: null, notice: null });
  useTourStore.setState({ isOpen: false, stepIndex: 0 });
});

describe('WelcomeTour', () => {
  it('abre sozinho na primeira visita, só depois que a triagem renderizou', async () => {
    const { rerender } = renderTriage({ ready: false });

    // Triagem ainda carregando: o guia não pode aparecer em cima do skeleton.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <>
        <Header />
        <TriageStub targets={TRIAGE_TARGETS} />
        <WelcomeTour ready />
      </>,
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Boas-vindas ao Logos' })).toBeVisible();
    expect(within(dialog).getByText('Passo 1 de 6')).toBeInTheDocument();
  });

  it('espera o alvo dos KPIs aparecer no DOM para abrir', async () => {
    const { rerender } = renderTriage({ targets: [] });

    await flushAutoOpen();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <>
        <Header />
        <TriageStub targets={TRIAGE_TARGETS} />
        <WelcomeTour ready />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('sem o alvo dos KPIs não abre e não marca como visto', async () => {
    renderTriage({ targets: [] });

    await flushAutoOpen();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
  });

  it('concluir grava a chave e o guia não abre mais sozinho; o "Guia" reabre', async () => {
    const user = userEvent.setup();
    const first = renderTriage();

    const dialog = await screen.findByRole('dialog');
    for (let index = 0; index < 5; index += 1) {
      await user.click(within(dialog).getByRole('button', { name: 'Próximo' }));
    }
    expect(screen.getByText('Passo 6 de 6')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Concluir' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');

    // Nova visita à triagem: com a chave gravada, o guia fica quieto.
    first.unmount();
    renderTriage();
    await flushAutoOpen();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // O botão "?" é a porta de entrada manual — e reabre no passo 1.
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
    await user.click(screen.getByRole('button', { name: 'Abrir o guia' }));

    const reopened = await screen.findByRole('dialog');
    expect(within(reopened).getByText('Passo 1 de 6')).toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });

  it('percorre os seis passos, com "Anterior" voltando um passo', async () => {
    const user = userEvent.setup();
    renderTriage();
    await screen.findByRole('dialog');

    expect(screen.getByText('Passo 1 de 6')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Boas-vindas ao Logos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    const steps = [
      { position: 2, title: 'Busca e filtros' },
      { position: 3, title: 'A fila priorizada' },
      { position: 4, title: 'Registrar incidente' },
      { position: 5, title: 'Tema' },
      { position: 6, title: 'Conexão' },
    ] as const;

    for (const { position, title } of steps) {
      await user.click(screen.getByRole('button', { name: 'Próximo' }));
      expect(screen.getByText(`Passo ${String(position)} de 6`)).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: 'Anterior' }));

    expect(screen.getByText('Passo 5 de 6')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tema' })).toBeInTheDocument();
  });

  it('no último passo o botão vira "Concluir"', async () => {
    const user = userEvent.setup();
    renderTriage();
    await screen.findByRole('dialog');

    for (let index = 0; index < 5; index += 1) {
      await user.click(screen.getByRole('button', { name: 'Próximo' }));
    }

    expect(screen.getByText('Passo 6 de 6')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Próximo' })).not.toBeInTheDocument();
  });

  it('conta só os passos que existem: sem o "novo incidente" o guia tem 5 passos', async () => {
    const user = userEvent.setup();
    // Neste branch o botão "Novo incidente" (PR #125) ainda não existe, então o
    // passo do cadastro é pulado — e o total cai de 6 para 5.
    renderTriage({ targets: ['kpis', 'filters', 'list'] });

    await screen.findByRole('dialog');
    expect(screen.getByText('Passo 1 de 5')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Passo 2 de 5')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Passo 3 de 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'A fila priorizada' })).toBeInTheDocument();

    // Da fila o guia vai direto para o tema: o cadastro não está no DOM.
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Passo 4 de 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tema' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Passo 5 de 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conexão' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeInTheDocument();
  });

  it('um alvo ausente não quebra o guia: sem a fila sobram 4 passos', async () => {
    const user = userEvent.setup();
    // Lista vazia: `IncidentList` não renderiza a seção com `data-tour`.
    renderTriage({ targets: ['kpis', 'filters'] });

    await screen.findByRole('dialog');
    expect(screen.getByText('Passo 1 de 4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Passo 2 de 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Busca e filtros' })).toBeInTheDocument();

    // Sem fila e sem cadastro, os dois passos do meio saem da conta.
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Passo 3 de 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tema' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Passo 4 de 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Concluir' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });

  it('pular o passo ausente também sai do passo do meio', async () => {
    const user = userEvent.setup();
    // Filtros ausentes: o passo 2 é pulado e a fila aparece na sequência.
    renderTriage({ targets: ['kpis', 'list'] });

    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Próximo' }));

    expect(screen.getByText('Passo 2 de 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'A fila priorizada' })).toBeInTheDocument();
  });

  it('Esc fecha o guia e grava a chave', async () => {
    const user = userEvent.setup();
    renderTriage();

    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });

  it('o cartão recebe o foco, prende o Tab e desenha as quatro faixas escuras', async () => {
    const user = userEvent.setup();
    renderTriage();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');

    // Quatro divs de fundo (topo, baixo, esquerda, direita) + o anel do alvo.
    expect(document.querySelectorAll('div.bg-overlay')).toHaveLength(4);

    const firstButton = within(dialog).getByRole('button', { name: 'Pular' });
    const lastButton = within(dialog).getByRole('button', { name: 'Próximo' });

    // Tab no último controle não escapa para o fundo: volta ao primeiro.
    lastButton.focus();
    await user.tab();
    expect(firstButton).toHaveFocus();

    // Shift+Tab no primeiro também não escapa: vai ao último.
    firstButton.focus();
    await user.tab({ shift: true });
    expect(lastButton).toHaveFocus();
  });

  it('"Guia" sem a triagem no DOM abre no primeiro passo que existe — o tema', async () => {
    const user = userEvent.setup();
    renderTriage({ targets: [] });

    await user.click(screen.getByRole('button', { name: 'Abrir o guia' }));

    // Sem KPIs não há saudação: sobram os dois alvos do cabeçalho, e o guia
    // abre no primeiro deles em vez de não fazer nada.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Passo 1 de 2')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Tema' })).toBeInTheDocument();
    // Abrir pelo "?" não marca o guia como visto.
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
  });

  it('um alvo escondido (display: none) sai do roteiro, em vez de virar um corte na origem', async () => {
    const user = userEvent.setup();
    renderTriage();
    await screen.findByRole('dialog');

    // Até o tema: passo 5 de 6, com a conexão ainda visível.
    for (let index = 0; index < 4; index += 1) {
      await user.click(screen.getByRole('button', { name: 'Próximo' }));
    }
    expect(screen.getByText('Passo 5 de 6')).toBeInTheDocument();

    // Abaixo de 640 px o indicador "ao vivo" some pelo CSS (`hidden sm:…`).
    const connection = document.querySelector<HTMLElement>('[data-tour="connection"]');
    if (connection === null) throw new Error('indicador de conexão ausente');
    connection.style.display = 'none';

    await waitFor(() => {
      expect(screen.getByText('Passo 5 de 5')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeInTheDocument();
  });
});

describe('acompanhamento do alvo', () => {
  function rectAt(left: number): DOMRect {
    return {
      x: left,
      y: 12,
      left,
      top: 12,
      width: 36,
      height: 36,
      right: left + 36,
      bottom: 48,
      toJSON: () => ({}),
    };
  }

  it('o corte acompanha o alvo quando o layout muda sem trocar de passo', async () => {
    const user = userEvent.setup();
    renderTriage();
    await screen.findByRole('dialog');
    for (let index = 0; index < 4; index += 1) {
      await user.click(screen.getByRole('button', { name: 'Próximo' }));
    }
    expect(screen.getByRole('heading', { name: 'Tema' })).toBeInTheDocument();

    const theme = document.querySelector<HTMLElement>('[data-tour="theme"]');
    if (theme === null) throw new Error('botão de tema ausente');
    let left = 100;
    vi.spyOn(theme, 'getBoundingClientRect').mockImplementation(() => rectAt(left));

    const ringLeft = (): string | undefined =>
      document.querySelector<HTMLElement>('.ring-2')?.style.left;

    await waitFor(() => {
      expect(ringLeft()).toBe('100px');
    });

    // O cabeçalho muda de largura à esquerda do tema (nome do usuário, fonte
    // que termina de carregar) sem nenhum `resize` ou `scroll`.
    left = 300;
    await waitFor(() => {
      expect(ringLeft()).toBe('300px');
    });
  });
});

describe('posicionamento do cartão e do corte', () => {
  const KPIS = { top: 120, left: 80, width: 860, height: 96, bottom: 216, right: 940 };

  it('abre abaixo do alvo quando há espaço', () => {
    const layout = computeCardLayout(KPIS, 1024, 768);

    expect(layout.top).toBe(KPIS.bottom + 12);
    expect(layout.left).toBe(KPIS.left);
    expect(layout.width).toBe(360);
  });

  it('sobe para cima do alvo quando a dobra não comporta o cartão', () => {
    const layout = computeCardLayout({ ...KPIS, top: 640, bottom: 736 }, 1024, 768);

    expect(layout.top).toBeLessThan(640);
    expect(layout.top).toBeGreaterThanOrEqual(12);
  });

  it('nunca sai da viewport — nem em tela estreita e baixa', () => {
    const layout = computeCardLayout(KPIS, 320, 480);

    expect(layout.left).toBeGreaterThanOrEqual(12);
    expect(layout.left + layout.width).toBeLessThanOrEqual(320 - 12);
    expect(layout.top).toBeGreaterThanOrEqual(12);
    expect(layout.top + layout.maxHeight).toBeLessThanOrEqual(480 - 12);
  });

  it('o corte recorta o alvo pela viewport (alvo maior que a tela)', () => {
    const hole = computeHole(
      { top: -40, left: -10, width: 2000, height: 2000, bottom: 1960, right: 1990 },
      1024,
      768,
    );

    expect(hole).toEqual({ top: 0, left: 0, bottom: 768, right: 1024, width: 1024, height: 768 });
  });
});
