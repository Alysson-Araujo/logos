import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { Header } from '@/components/layout/Header';
import { useAuthStore } from '@/features/auth/useAuthStore';

import { computeCardLayout, computeHole, TOUR_STORAGE_KEY, useTourStore } from './useTour';
import { WelcomeTour } from './WelcomeTour';

type Target = 'kpis' | 'filters' | 'list';

const ALL_TARGETS: readonly Target[] = ['kpis', 'filters', 'list'];

/** Triagem de mentira: só as áreas que o guia procura no DOM. */
function TriageStub({ targets }: { targets: readonly Target[] }) {
  return (
    <>
      {targets.map((target) => (
        <section key={target} data-tour={target} aria-label={`Área ${target}`} />
      ))}
    </>
  );
}

interface RenderOptions {
  targets?: readonly Target[];
  ready?: boolean;
}

function renderTriage({ targets = ALL_TARGETS, ready = true }: RenderOptions = {}) {
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
        <TriageStub targets={ALL_TARGETS} />
        <WelcomeTour ready />
      </>,
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Boas-vindas ao Logos' })).toBeVisible();
    expect(within(dialog).getByText('Passo 1 de 3')).toBeInTheDocument();
  });

  it('espera o alvo dos KPIs aparecer no DOM para abrir', async () => {
    const { rerender } = renderTriage({ targets: [] });

    await flushAutoOpen();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <>
        <Header />
        <TriageStub targets={ALL_TARGETS} />
        <WelcomeTour ready />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('sem nenhum alvo não abre e não marca como visto', async () => {
    renderTriage({ targets: [] });

    await flushAutoOpen();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
  });

  it('concluir grava a chave e o guia não abre mais sozinho; o "?" reabre', async () => {
    const user = userEvent.setup();
    const first = renderTriage();

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Próximo' }));
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Passo 3 de 3')).toBeInTheDocument();

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
    expect(within(reopened).getByText('Passo 1 de 3')).toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });

  it('"Próximo" e "Anterior" trocam o passo e o contador', async () => {
    const user = userEvent.setup();
    renderTriage();
    await screen.findByRole('dialog');

    expect(screen.getByText('Passo 1 de 3')).toBeInTheDocument();
    expect(screen.getByText('Boas-vindas ao Logos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));

    expect(screen.getByText('Passo 2 de 3')).toBeInTheDocument();
    expect(screen.getByText('Busca e filtros')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Anterior' }));

    expect(screen.getByText('Passo 1 de 3')).toBeInTheDocument();
    expect(screen.getByText('Boas-vindas ao Logos')).toBeInTheDocument();
  });

  it('no último passo o botão vira "Concluir"', async () => {
    const user = userEvent.setup();
    renderTriage();
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    await user.click(screen.getByRole('button', { name: 'Próximo' }));

    expect(screen.getByText('Passo 3 de 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Próximo' })).not.toBeInTheDocument();
  });

  it('um alvo ausente não quebra o guia: a fila vazia encerra no passo 2', async () => {
    const user = userEvent.setup();
    // Lista vazia: `IncidentList` não renderiza a seção com `data-tour`.
    renderTriage({ targets: ['kpis', 'filters'] });

    await screen.findByRole('dialog');
    expect(screen.getByText('Passo 1 de 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Passo 2 de 3')).toBeInTheDocument();
    expect(screen.getByText('Busca e filtros')).toBeInTheDocument();

    // Sem fila, o passo 3 não existe: o botão vira "Concluir" no passo 2.
    expect(screen.queryByRole('button', { name: 'Próximo' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Concluir' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });

  it('pular o passo ausente também sai do passo do meio', async () => {
    const user = userEvent.setup();
    // Filtros ausentes: o passo 2 é pulado e o 3 aparece na sequência.
    renderTriage({ targets: ['kpis', 'list'] });

    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Próximo' }));

    expect(screen.getByText('Passo 3 de 3')).toBeInTheDocument();
    expect(screen.getByText('Fila priorizada')).toBeInTheDocument();
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

  it('o botão "?" do cabeçalho é acessível e fica no canto superior esquerdo', () => {
    render(<Header />);

    const helpButton = screen.getByRole('button', { name: 'Abrir o guia' });
    expect(helpButton).toHaveAccessibleName('Abrir o guia');
    expect(helpButton).toHaveAttribute('title', 'Abrir o guia');
    // É o primeiro controle do cabeçalho no DOM: o canto esquerdo.
    expect(helpButton.compareDocumentPosition(screen.getByText('LOGOS'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('"?" sem alvos no DOM não abre o guia', async () => {
    const user = userEvent.setup();
    renderTriage({ targets: [] });

    await user.click(screen.getByRole('button', { name: 'Abrir o guia' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
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
