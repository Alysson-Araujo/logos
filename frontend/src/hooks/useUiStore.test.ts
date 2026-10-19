import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDensity, useSearchFocus, useUiStore } from './useUiStore';

/**
 * Estado de UI da lista: densidade e o pedido de foco na busca (seções 9.1 e 8.4).
 *
 * O que este teste protege: a densidade é uma escolha de leitura que a pessoa
 * fez, e perdê-la a cada recarregamento obriga a reconfigurar a tela toda vez. O
 * `searchFocusToken` protege o outro lado: o atalho `/` precisa focar a busca
 * **uma vez por pedido** — um token que não muda deixa o `/` sem efeito, e uma
 * primeira execução do efeito que não seja ignorada rouba o foco ao abrir a tela.
 */

const DENSITY_STORAGE_KEY = 'logos-density';

beforeEach(() => {
  useUiStore.setState({ density: 'comfortable', searchFocusToken: 0 });
  document.documentElement.removeAttribute('data-density');
});

afterEach(() => {
  document.documentElement.removeAttribute('data-density');
});

describe('useUiStore — densidade', () => {
  it('começa confortável', () => {
    expect(useUiStore.getState().density).toBe('comfortable');
  });

  it('setDensity troca a densidade e grava a escolha', () => {
    act(() => {
      useUiStore.getState().setDensity('compact');
    });

    expect(useUiStore.getState().density).toBe('compact');
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact');
  });

  it('toggleDensity alterna e persiste nos dois sentidos', () => {
    act(() => {
      useUiStore.getState().toggleDensity();
    });
    expect(useUiStore.getState().density).toBe('compact');
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact');

    act(() => {
      useUiStore.getState().toggleDensity();
    });
    expect(useUiStore.getState().density).toBe('comfortable');
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('comfortable');
  });
});

describe('useUiStore — pedido de foco na busca', () => {
  it('cada pedido incrementa o token, inclusive repetidos', () => {
    expect(useUiStore.getState().searchFocusToken).toBe(0);

    act(() => {
      useUiStore.getState().requestSearchFocus();
    });
    expect(useUiStore.getState().searchFocusToken).toBe(1);

    act(() => {
      useUiStore.getState().requestSearchFocus();
    });
    // Dois `/` seguidos precisam valer dois focos: um contador que só fosse de
    // 0 para 1 deixaria o segundo atalho sem efeito.
    expect(useUiStore.getState().searchFocusToken).toBe(2);
  });
});

describe('useUiStore — hidratação do localStorage', () => {
  it('começa compacto quando a preferência gravada é compacta', async () => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'compact');

    vi.resetModules();
    const recarregado = await import('./useUiStore');

    expect(recarregado.useUiStore.getState().density).toBe('compact');
  });

  it('ignora valor gravado fora do contrato e volta ao padrão', async () => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'gigante');

    vi.resetModules();
    const recarregado = await import('./useUiStore');

    expect(recarregado.useUiStore.getState().density).toBe('comfortable');
  });
});

describe('useDensity', () => {
  it('espelha a densidade no documento para os tokens de espaçamento responderem', () => {
    const { result } = renderHook(() => useDensity());

    expect(result.current).toBe('comfortable');
    expect(document.documentElement.dataset.density).toBe('comfortable');

    act(() => {
      useUiStore.getState().setDensity('compact');
    });

    expect(result.current).toBe('compact');
    expect(document.documentElement.dataset.density).toBe('compact');
  });
});

describe('useSearchFocus', () => {
  /** Campos criados à mão: o `cleanup` do Testing Library só remove o que ele renderizou. */
  const camposCriados: HTMLInputElement[] = [];

  afterEach(() => {
    for (const campo of camposCriados.splice(0)) campo.remove();
  });

  function renderSearchFocus(initialToken: number) {
    const input = document.createElement('input');
    input.value = 'BR-116';
    document.body.appendChild(input);
    camposCriados.push(input);
    const inputRef = { current: input };

    const view = renderHook(
      ({ token }: { token: number }) => {
        useSearchFocus(token, inputRef);
      },
      { initialProps: { token: initialToken } },
    );

    return { ...view, input };
  }

  it('não rouba o foco na primeira renderização (token 0)', () => {
    const { input } = renderSearchFocus(0);

    expect(input).not.toHaveFocus();
  });

  it('foca e seleciona o texto quando o token muda', () => {
    const { input, rerender } = renderSearchFocus(0);

    rerender({ token: 1 });

    expect(input).toHaveFocus();
    // Selecionar é o que permite digitar por cima da busca anterior.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('BR-116'.length);
  });

  it('não mexe no foco quando o token é re-renderizado sem mudar', () => {
    const { input, rerender } = renderSearchFocus(0);
    input.blur();

    rerender({ token: 0 });

    expect(input).not.toHaveFocus();
  });

  it('tolera a ausência do campo (ref vazia) sem estourar', () => {
    const inputRef: { current: HTMLInputElement | null } = { current: null };
    const { rerender } = renderHook(
      ({ token }: { token: number }) => {
        useSearchFocus(token, inputRef);
      },
      { initialProps: { token: 0 } },
    );

    expect(() => {
      rerender({ token: 1 });
    }).not.toThrow();
  });
});
