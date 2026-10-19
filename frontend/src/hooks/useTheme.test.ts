import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTheme, useThemeStore } from './useTheme';

/**
 * Tema claro/escuro, com `system` acompanhando o sistema operacional.
 *
 * O que este teste protege: três formas de o tema mentir para a pessoa. A
 * primeira é não ser aplicado no `<html>` — a interface fica clara com os tokens
 * escuros (ou o contrário), e a tela vira um borrão ilegível. A segunda é a
 * escolha não sobreviver ao recarregamento, o que obriga a reconfigurar o tema a
 * cada visita. A terceira é `system` parar de acompanhar o sistema depois da
 * primeira pintura: quem troca o tema do computador ao anoitecer espera que a
 * aplicação acompanhe, e não que fique presa no claro de meio-dia.
 *
 * O `matchMedia` do setup é substituído por um controlável porque é ele que
 * representa o sistema operacional — sem poder movê-lo, "acompanha o sistema" não
 * teria como ser verificado.
 */

const THEME_STORAGE_KEY = 'logos-theme';

const media = {
  matches: false,
  listeners: new Set<(event: MediaQueryListEvent) => void>(),
};

/** Substitui o stub do setup por um em que o teste decide a preferência do sistema. */
function installControllableMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      get matches(): boolean {
        return media.matches;
      },
      media: query,
      onchange: null,
      addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void): void => {
        if (type === 'change') media.listeners.add(listener);
      },
      removeEventListener: (type: string, listener: (event: MediaQueryListEvent) => void): void => {
        if (type === 'change') media.listeners.delete(listener);
      },
      addListener: (): void => undefined,
      removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    }),
  });
}

/** Troca a preferência do sistema e avisa quem está ouvindo, como o navegador faz. */
function setSystemPrefersDark(prefersDark: boolean): void {
  media.matches = prefersDark;
  const event = { matches: prefersDark } as MediaQueryListEvent;
  act(() => {
    for (const listener of [...media.listeners]) listener(event);
  });
}

function darkClassApplied(): boolean {
  return document.documentElement.classList.contains('dark');
}

beforeEach(() => {
  media.matches = false;
  media.listeners.clear();
  installControllableMatchMedia();
  useThemeStore.setState({ theme: 'system' });
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-theme');
});

describe('useTheme — resolução do tema', () => {
  it('resolve para claro quando a preferência é system e o sistema está no claro', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('system');
    expect(result.current.resolvedTheme).toBe('light');
    expect(darkClassApplied()).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('resolve para escuro quando a preferência é system e o sistema está no escuro', () => {
    media.matches = true;

    const { result } = renderHook(() => useTheme());

    expect(result.current.resolvedTheme).toBe('dark');
    expect(darkClassApplied()).toBe(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('acompanha o sistema operacional enquanto a preferência for system', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolvedTheme).toBe('light');

    setSystemPrefersDark(true);
    expect(result.current.resolvedTheme).toBe('dark');
    expect(darkClassApplied()).toBe(true);

    // E volta: quem desliga o modo escuro do sistema espera a aplicação clara.
    setSystemPrefersDark(false);
    expect(result.current.resolvedTheme).toBe('light');
    expect(darkClassApplied()).toBe(false);
  });

  it('a escolha explícita vence o sistema nos dois sentidos', () => {
    media.matches = true;
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('light');
    });

    expect(result.current.resolvedTheme).toBe('light');
    expect(darkClassApplied()).toBe(false);

    act(() => {
      result.current.setTheme('dark');
    });

    expect(result.current.resolvedTheme).toBe('dark');
    expect(darkClassApplied()).toBe(true);
  });

  it('deixa de acompanhar o sistema depois que a pessoa escolhe', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('light');
    });
    setSystemPrefersDark(true);

    // Escolher claro é uma decisão: o sistema escuro não pode desfazê-la.
    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
    expect(darkClassApplied()).toBe(false);
  });
});

describe('useTheme — alternância e persistência', () => {
  it('toggleTheme alterna do claro para o escuro e grava a escolha', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('toggleTheme parte do tema resolvido: com o sistema escuro, o primeiro toque clareia', () => {
    media.matches = true;
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('volta ao claro e regrava a escolha', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });
    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('setTheme persiste sem tocar no sistema operacional', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('dark');
    });

    expect(useThemeStore.getState().theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(media.matches).toBe(false);
  });
});

describe('useTheme — carga a partir do localStorage', () => {
  it('restaura a preferência gravada ao carregar o módulo', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    vi.resetModules();
    const recarregado = await import('./useTheme');

    expect(recarregado.useThemeStore.getState().theme).toBe('dark');

    const { result } = renderHook(() => recarregado.useTheme());
    // Preferência gravada `dark` com o sistema no claro: o tema tem que abrir
    // escuro já na primeira pintura, sem piscar claro antes.
    expect(result.current.resolvedTheme).toBe('dark');
    expect(darkClassApplied()).toBe(true);
  });

  it('ignora valor gravado fora do contrato e volta a seguir o sistema', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'roxo');

    vi.resetModules();
    const recarregado = await import('./useTheme');

    expect(recarregado.useThemeStore.getState().theme).toBe('system');
  });
});
