import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppFooter } from '@/components/layout/AppFooter';
import { Header } from '@/components/layout/Header';
import { useAuthStore } from '@/features/auth/useAuthStore';

import { TOUR_STEPS, type TourTarget } from './steps';
import { computeCardLayout, computeHole, TOUR_STORAGE_KEY, useTourStore } from './useTour';
import { WelcomeTour } from './WelcomeTour';

/**
 * Alvos que a triagem marca. Tema, conexão e "Guia" ficam de fora porque quem
 * os marca é o `Header`, e os atalhos porque quem os marca é o `AppFooter` —
 * os dois entram em todos os cenários abaixo. Ou seja: esses quatro **sempre**
 * existem, mesmo quando a triagem não renderizou nada.
 */
const TRIAGE_TARGETS: readonly TourTarget[] = ['kpis', 'filters', 'list', 'create'];

/** Alvos que o cabeçalho e o rodapé garantem, com ou sem triagem. */
const SHELL_TARGETS = 4;

/** Total esperado do contador: alvos da triagem + os do cabeçalho e rodapé. */
function totalFor(targets: readonly TourTarget[]): number {
  return targets.length + SHELL_TARGETS;
}

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
  /** O mesmo `handleCreate` do botão "Novo incidente", como no `App`. */
  onCreate?: () => void;
  /** O mesmo `onClose` da `CreateIncidentSheet`, como no `App`. */
  onCloseCreate?: () => void;
}

function renderTriage({
  targets = TRIAGE_TARGETS,
  ready = true,
  onCreate,
  onCloseCreate,
}: RenderOptions = {}) {
  return render(
    <>
      <Header />
      <TriageStub targets={targets} />
      <AppFooter />
      <WelcomeTour ready={ready} onOpenCreate={onCreate} onCloseCreate={onCloseCreate} />
    </>,
  );
}

async function flushAutoOpen(): Promise<void> {
  // O tour espera 50 ms entre tentativas: dois ciclos bastam para provar que
  // ele **não** abriu.
  await new Promise((resolve) => setTimeout(resolve, 120));
}

/** Anda `count` passos para a frente a partir do passo atual. */
async function advance(user: ReturnType<typeof userEvent.setup>, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
  }
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
        <AppFooter />
        <WelcomeTour ready />
      </>,
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Boas-vindas ao Logos' })).toBeVisible();
    expect(within(dialog).getByText('Passo 1 de 8')).toBeInTheDocument();
  });

  it('espera o alvo dos KPIs aparecer no DOM para abrir', async () => {
    const { rerender } = renderTriage({ targets: [] });

    await flushAutoOpen();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <>
        <Header />
        <TriageStub targets={TRIAGE_TARGETS} />
        <AppFooter />
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

    await screen.findByRole('dialog');
    await advance(user, 7);
    expect(screen.getByText('Passo 8 de 8')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Concluir' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');

    // Nova visita à triagem: com a chave gravada, o guia fica quieto.
    first.unmount();
    renderTriage();
    await flushAutoOpen();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // O botão "Guia" é a porta de entrada manual — e reabre no passo 1.
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
    await user.click(screen.getByRole('button', { name: 'Abrir o guia' }));

    const reopened = await screen.findByRole('dialog');
    expect(within(reopened).getByText('Passo 1 de 8')).toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });

  it('percorre os oito passos, com "Anterior" voltando um passo', async () => {
    const user = userEvent.setup();
    renderTriage();
    await screen.findByRole('dialog');

    expect(screen.getByText('Passo 1 de 8')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Boas-vindas ao Logos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    const steps = [
      { position: 2, title: 'Busca e filtros' },
      { position: 3, title: 'A fila priorizada' },
      { position: 4, title: 'Registrar incidente' },
      { position: 5, title: 'Tema' },
      { position: 6, title: 'Conexão' },
      { position: 7, title: 'Atalhos do teclado' },
      { position: 8, title: 'Sempre que precisar' },
    ] as const;

    for (const { position, title } of steps) {
      await user.click(screen.getByRole('button', { name: 'Próximo' }));
      expect(screen.getByText(`Passo ${String(position)} de 8`)).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }

    await user.click(screen.getByRole('button', { name: 'Anterior' }));

    expect(screen.getByText('Passo 7 de 8')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Atalhos do teclado' })).toBeInTheDocument();
  });

  it('os textos são os do Figma, sem crase de markdown', async () => {
    const user = userEvent.setup();
    renderTriage();
    const dialog = await screen.findByRole('dialog');

    // O cartão renderiza texto puro: qualquer crase apareceria na tela.
    for (const { body } of TOUR_STEPS) {
      expect(body).not.toContain('`');
    }

    await advance(user, 2);
    expect(
      screen.getByText(
        'A ordem não é manual: cada incidente tem um score calculado pela criticidade e pelo tempo em aberto. O relógio à direita é o SLA — quando fica vermelho, o prazo estourou. Atalhos: j e k navegam, Enter abre, / busca.',
      ),
    ).toBeInTheDocument();

    await advance(user, 3);
    expect(
      within(dialog).getByText(
        'Este indicador mostra se a API está respondendo. Sem conexão, a fila continua com o último estado carregado e avisa antes de qualquer ação que precise do servidor.',
      ),
    ).toBeInTheDocument();
  });

  it('no último passo o botão vira "Concluir"', async () => {
    const user = userEvent.setup();
    renderTriage();
    await screen.findByRole('dialog');

    await advance(user, 7);

    expect(screen.getByText('Passo 8 de 8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Próximo' })).not.toBeInTheDocument();
  });

  it('conta só os passos que existem: sem o "novo incidente" o guia tem 7 passos', async () => {
    const user = userEvent.setup();
    const targets = ['kpis', 'filters', 'list'] as const;
    // O passo do cadastro é pulado quando o botão não está no DOM — e o total
    // cai de 8 para 7.
    renderTriage({ targets });

    await screen.findByRole('dialog');
    expect(screen.getByText(`Passo 1 de ${String(totalFor(targets))}`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText(`Passo 2 de ${String(totalFor(targets))}`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText(`Passo 3 de ${String(totalFor(targets))}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'A fila priorizada' })).toBeInTheDocument();

    // Da fila o guia vai direto para o tema: o cadastro não está no DOM.
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText(`Passo 4 de ${String(totalFor(targets))}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tema' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText(`Passo 5 de ${String(totalFor(targets))}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conexão' })).toBeInTheDocument();
  });

  it('um alvo ausente não quebra o guia: sem a fila sobram 6 passos', async () => {
    const user = userEvent.setup();
    const targets = ['kpis', 'filters'] as const;
    // Lista vazia: `IncidentList` não renderiza a seção com `data-tour`.
    renderTriage({ targets });
    const total = totalFor(targets);

    await screen.findByRole('dialog');
    expect(screen.getByText(`Passo 1 de ${String(total)}`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText(`Passo 2 de ${String(total)}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Busca e filtros' })).toBeInTheDocument();

    // Sem fila e sem cadastro, os dois passos do meio saem da conta.
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText(`Passo 3 de ${String(total)}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tema' })).toBeInTheDocument();

    await advance(user, 3);
    expect(screen.getByText(`Passo 6 de ${String(total)}`)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sempre que precisar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Concluir' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });

  it('pular o passo ausente também sai do passo do meio', async () => {
    const user = userEvent.setup();
    const targets = ['kpis', 'list'] as const;
    // Filtros ausentes: o passo 2 é pulado e a fila aparece na sequência.
    renderTriage({ targets });

    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Próximo' }));

    expect(screen.getByText(`Passo 2 de ${String(totalFor(targets))}`)).toBeInTheDocument();
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

    // Sem KPIs não há saudação: sobram os alvos do cabeçalho e do rodapé, e o
    // guia abre no primeiro deles em vez de não fazer nada.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(`Passo 1 de ${String(SHELL_TARGETS)}`)).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Tema' })).toBeInTheDocument();
    // Abrir pelo "Guia" não marca o guia como visto.
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
  });

  it('um alvo escondido (display: none) sai do roteiro, em vez de virar um corte na origem', async () => {
    const user = userEvent.setup();
    renderTriage();
    await screen.findByRole('dialog');

    // Até o tema: passo 5 de 8, com a conexão ainda visível.
    await advance(user, 4);
    expect(screen.getByText('Passo 5 de 8')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tema' })).toBeInTheDocument();

    // Abaixo de 640 px o indicador "ao vivo" some pelo CSS (`hidden sm:…`).
    const connection = document.querySelector<HTMLElement>('[data-tour="connection"]');
    if (connection === null) throw new Error('indicador de conexão ausente');
    connection.style.display = 'none';

    await waitFor(() => {
      expect(screen.getByText('Passo 5 de 7')).toBeInTheDocument();
    });

    // A conexão saiu da conta **e** do caminho: "Próximo" vai direto aos atalhos.
    await user.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('Passo 6 de 7')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Atalhos do teclado' })).toBeInTheDocument();
  });
});

describe('o passo do cadastro abre a janela', () => {
  it('abre ao chegar no passo 4 e fecha ao avançar', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onCloseCreate = vi.fn();
    renderTriage({ onCreate, onCloseCreate });

    await screen.findByRole('dialog');
    expect(onCreate).not.toHaveBeenCalled();

    await advance(user, 3);
    expect(screen.getByText('Passo 4 de 8')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Registrar incidente' })).toBeInTheDocument();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCloseCreate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Próximo' }));

    expect(screen.getByText('Passo 5 de 8')).toBeInTheDocument();
    expect(onCloseCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('voltar do passo 5 reabre a janela; voltar de novo fecha', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onCloseCreate = vi.fn();
    renderTriage({ onCreate, onCloseCreate });

    await screen.findByRole('dialog');
    await advance(user, 4);
    expect(screen.getByText('Passo 5 de 8')).toBeInTheDocument();
    expect(onCloseCreate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Anterior' }));

    expect(screen.getByText('Passo 4 de 8')).toBeInTheDocument();
    expect(onCreate).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Anterior' }));

    expect(screen.getByText('Passo 3 de 8')).toBeInTheDocument();
    expect(onCloseCreate).toHaveBeenCalledTimes(2);
  });

  it('fechar o guia no passo 4 fecha a janela', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onCloseCreate = vi.fn();
    renderTriage({ onCreate, onCloseCreate });

    await screen.findByRole('dialog');
    await advance(user, 3);
    expect(onCreate).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onCloseCreate).toHaveBeenCalledTimes(1);
  });

  it('"Pular" no passo 4 fecha a janela', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onCloseCreate = vi.fn();
    renderTriage({ onCreate, onCloseCreate });

    await screen.findByRole('dialog');
    await advance(user, 3);
    expect(onCreate).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Pular' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onCloseCreate).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });

  it('sem o alvo do cadastro o guia nunca abre a janela', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onCloseCreate = vi.fn();
    const targets = ['kpis', 'filters', 'list'] as const;
    renderTriage({ targets, onCreate, onCloseCreate });

    await screen.findByRole('dialog');
    await advance(user, totalFor(targets) - 1);
    await user.click(screen.getByRole('button', { name: 'Concluir' }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(onCloseCreate).not.toHaveBeenCalled();
  });

  it('no passo do cadastro o véu sai de cena e o anel do alvo continua', async () => {
    const user = userEvent.setup();
    renderTriage();

    await screen.findByRole('dialog');
    expect(document.querySelectorAll('div.bg-overlay')).toHaveLength(4);

    await advance(user, 3);

    // O formulário fica legível: nada de véu escuro sobre a janela aberta.
    expect(screen.getByText('Passo 4 de 8')).toBeInTheDocument();
    expect(document.querySelectorAll('div.bg-overlay')).toHaveLength(0);
    // O anel continua marcando o botão "Novo incidente".
    expect(document.querySelectorAll('.ring-2')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Próximo' }));

    expect(document.querySelectorAll('div.bg-overlay')).toHaveLength(4);
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
    await advance(user, 4);
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
