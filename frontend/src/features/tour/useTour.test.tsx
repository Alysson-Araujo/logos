import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOUR_STEPS, type TourTarget } from './steps';
import {
  availableStepIndexes,
  findAvailableStep,
  hasNextStep,
  hasPreviousStep,
  hasSeenTour,
  startTour,
  TOUR_STORAGE_KEY,
  useTour,
  useTourStore,
} from './useTour';

/**
 * Guia de boas-vindas: o estado do roteiro e o que o passo atual faz.
 *
 * O que este teste protege: o guia é a primeira coisa que uma pessoa vê, e três
 * defeitos aqui são caros. **Abrir sem alvo** — o corte do spotlight seria
 * desenhado no canto da tela, apontando para nada. **Pular o passo errado** — a
 * triagem esconde áreas (a lista vazia não renderiza a seção, o indicador de
 * conexão some abaixo de 640 px), e avançar para um passo cujo alvo não existe
 * deixaria o cartão órfão sobre a tela. E **reabrir sozinho** — quem já concluiu
 * não pode ser interrompido de novo a cada visita; é a chave no `localStorage`
 * que garante isso, e ela é gravada até quando o guia é fechado com `Esc`.
 *
 * O roteiro é montado direto no DOM (`data-tour`), como o tour o encontra em
 * produção: quem marca as áreas são os componentes reais, e o guia não os
 * conhece.
 */

const ROTEIRO_COMPLETO: readonly TourTarget[] = [
  'kpis',
  'filters',
  'list',
  'create',
  'theme',
  'connection',
  'shortcuts',
  'guide',
];

/** Marca no documento os alvos que existem neste cenário. */
function montarAlvos(targets: readonly TourTarget[]): void {
  for (const target of targets) {
    const elemento = document.createElement('section');
    elemento.setAttribute('data-tour', target);
    document.body.appendChild(elemento);
  }
}

function desmontarAlvos(): void {
  for (const elemento of document.body.querySelectorAll('[data-tour]')) {
    elemento.remove();
  }
}

beforeEach(() => {
  desmontarAlvos();
  window.localStorage.clear();
  useTourStore.setState({ isOpen: false, stepIndex: 0 });
});

afterEach(() => {
  desmontarAlvos();
});

describe('useTourStore — abrir', () => {
  it('abre no primeiro passo cujo alvo existe', () => {
    montarAlvos(['kpis', 'list']);

    useTourStore.getState().open();

    expect(useTourStore.getState().isOpen).toBe(true);
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('sem alvo dos KPIs, abre no primeiro que existir — em vez de não abrir', () => {
    montarAlvos(['theme', 'connection']);

    startTour();

    // A triagem ainda não renderizou, mas os alvos do cabeçalho existem: é
    // melhor mostrar o guia daquilo que está na tela do que não mostrar nada.
    expect(useTourStore.getState().isOpen).toBe(true);
    expect(useTourStore.getState().stepIndex).toBe(
      TOUR_STEPS.findIndex((s) => s.target === 'theme'),
    );
  });

  it('sem nenhum alvo, não abre — e não marca o guia como visto', () => {
    useTourStore.getState().open();

    // Marcar como visto aqui faria a pessoa perder o guia para sempre por causa
    // de uma tela que ainda estava carregando.
    expect(useTourStore.getState().isOpen).toBe(false);
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
    expect(hasSeenTour()).toBe(false);
  });
});

describe('useTourStore — avançar, voltar e concluir', () => {
  it('avança para o próximo passo existente', () => {
    montarAlvos(ROTEIRO_COMPLETO);
    useTourStore.getState().open();

    useTourStore.getState().next();
    expect(useTourStore.getState().stepIndex).toBe(1);

    useTourStore.getState().next();
    expect(useTourStore.getState().stepIndex).toBe(2);
  });

  it('pula o passo cujo alvo não está no DOM', () => {
    // Sem a barra de filtros (lista vazia, por exemplo): o roteiro vai da
    // saudação direto para a fila.
    montarAlvos(['kpis', 'list']);
    useTourStore.getState().open();

    useTourStore.getState().next();

    expect(useTourStore.getState().stepIndex).toBe(2);
  });

  it('no último passo, "avançar" conclui: fecha e grava a chave', () => {
    montarAlvos(['kpis']);
    useTourStore.getState().open();

    useTourStore.getState().next();

    expect(useTourStore.getState().isOpen).toBe(false);
    expect(useTourStore.getState().stepIndex).toBe(0);
    // Concluir e pular são o mesmo caminho: nos dois casos o guia não volta
    // sozinho na próxima visita.
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });

  it('volta um passo e para no primeiro, sem sair do lugar', () => {
    montarAlvos(ROTEIRO_COMPLETO);
    useTourStore.getState().open();
    useTourStore.getState().next();
    useTourStore.getState().next();

    useTourStore.getState().previous();
    expect(useTourStore.getState().stepIndex).toBe(1);

    useTourStore.getState().previous();
    useTourStore.getState().previous();
    expect(useTourStore.getState().stepIndex).toBe(0);
    expect(useTourStore.getState().isOpen).toBe(true);
  });

  it('voltar também pula o passo ausente', () => {
    montarAlvos(['kpis', 'list']);
    useTourStore.setState({ isOpen: true, stepIndex: 2 });

    useTourStore.getState().previous();

    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('goTo fica dentro do roteiro, mesmo com índice fora da faixa', () => {
    useTourStore.getState().goTo(-5);
    expect(useTourStore.getState().stepIndex).toBe(0);

    useTourStore.getState().goTo(99);
    expect(useTourStore.getState().stepIndex).toBe(TOUR_STEPS.length - 1);
  });

  it('dismiss fecha, volta ao começo e grava a chave', () => {
    montarAlvos(ROTEIRO_COMPLETO);
    useTourStore.setState({ isOpen: true, stepIndex: 3 });

    useTourStore.getState().dismiss();

    expect(useTourStore.getState()).toMatchObject({ isOpen: false, stepIndex: 0 });
    expect(hasSeenTour()).toBe(true);
  });
});

describe('roteiro disponível', () => {
  it('lista só os passos que existem hoje, na ordem do roteiro', () => {
    montarAlvos(['kpis', 'list', 'guide']);

    expect(availableStepIndexes()).toEqual([0, 2, 7]);
  });

  it('avançar e voltar respondem pelo DOM, e não pelo índice', () => {
    montarAlvos(['kpis', 'theme']);

    expect(hasNextStep(0)).toBe(true);
    expect(hasPreviousStep(0)).toBe(false);
    // Do passo do tema não há mais nada à frente: "Próximo" ali conclui.
    expect(hasNextStep(4)).toBe(false);
    expect(hasPreviousStep(4)).toBe(true);
  });

  it('devolve null quando não há nada na direção pedida', () => {
    montarAlvos(['list']);

    expect(findAvailableStep(3, 1)).toBeNull();
    expect(findAvailableStep(1, -1)).toBeNull();
    expect(findAvailableStep(2, 1)).toBe(2);
    expect(findAvailableStep(2, -1)).toBe(2);
  });
});

describe('useTour — abertura automática', () => {
  it('abre sozinho na primeira visita, depois que a triagem renderizou', async () => {
    montarAlvos(ROTEIRO_COMPLETO);

    const { result } = renderHook(() => useTour(true));

    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    });
    expect(result.current.step.target).toBe('kpis');
    expect(result.current.isCreateSheetStep).toBe(false);
  });

  it('espera a triagem ficar pronta: não abre em cima do carregamento', async () => {
    montarAlvos(ROTEIRO_COMPLETO);
    const { result, rerender } = renderHook(({ ready }: { ready: boolean }) => useTour(ready), {
      initialProps: { ready: false },
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    expect(result.current.isOpen).toBe(false);

    rerender({ ready: true });

    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    });
  });

  it('quem já concluiu não é interrompido de novo', async () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, 'done');
    montarAlvos(ROTEIRO_COMPLETO);

    const { result } = renderHook(() => useTour(true));

    // O guia continua acessível pelo botão "Guia"; o que não acontece é ele
    // abrir por cima da triagem sem ninguém pedir.
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.step.target).toBe('kpis');
  });

  it('sem o alvo dos KPIs, espera ele aparecer (a triagem carrega depois)', async () => {
    const { result } = renderHook(() => useTour(true));

    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
    expect(result.current.isOpen).toBe(false);

    act(() => {
      montarAlvos(['kpis']);
    });

    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    });
  });
});

describe('useTour — contador e controles', () => {
  it('conta só os passos que existem hoje', async () => {
    montarAlvos(['kpis', 'list']);

    const { result } = renderHook(() => useTour(true));
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.total).toBe(2);
    });

    expect(result.current.position).toBe(1);
  });

  it('canGoNext e canGoPrevious refletem os alvos disponíveis', async () => {
    montarAlvos(['kpis', 'list']);

    const { result } = renderHook(() => useTour(true));
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    });

    expect(result.current.canGoPrevious).toBe(false);
    expect(result.current.canGoNext).toBe(true);

    act(() => {
      result.current.next();
    });

    expect(result.current.step.target).toBe('list');
    expect(result.current.canGoNext).toBe(false);
    expect(result.current.canGoPrevious).toBe(true);
  });

  it('Esc é o mesmo que pular: fecha e grava a chave', async () => {
    montarAlvos(['kpis']);
    const { result } = renderHook(() => useTour(true));
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(result.current.isOpen).toBe(false);
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });
});

describe('useTour — passo do cadastro', () => {
  it('abre a janela ao entrar no passo e fecha ao sair dele', async () => {
    montarAlvos(['kpis', 'create']);
    const onOpenCreate = vi.fn();
    const onCloseCreate = vi.fn();

    const { result } = renderHook(() => useTour(true, { onOpenCreate, onCloseCreate }));
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    });
    expect(onOpenCreate).not.toHaveBeenCalled();

    act(() => {
      result.current.next();
    });

    expect(result.current.isCreateSheetStep).toBe(true);
    expect(onOpenCreate).toHaveBeenCalledTimes(1);
    expect(onCloseCreate).not.toHaveBeenCalled();

    // Último passo disponível: avançar conclui o guia, e a janela fecha junto.
    act(() => {
      result.current.next();
    });

    expect(onCloseCreate).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done');
  });

  it('sem o alvo do cadastro, o guia nunca abre a janela', async () => {
    montarAlvos(['kpis', 'list']);
    const onOpenCreate = vi.fn();
    const onCloseCreate = vi.fn();

    const { result } = renderHook(() => useTour(true, { onOpenCreate, onCloseCreate }));
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    });

    act(() => {
      result.current.next();
    });
    act(() => {
      result.current.next();
    });

    expect(onOpenCreate).not.toHaveBeenCalled();
    expect(onCloseCreate).not.toHaveBeenCalled();
  });
});
