import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useOnlineStatus } from './useOnlineStatus';

/**
 * Indicador de conexão (estado de UI `offline`, seção 8.2).
 *
 * O que este teste protege: o aviso de "sem conexão" não pode mentir em nenhuma
 * das duas direções. Continuar dizendo "ao vivo" depois que a rede caiu faz a
 * pessoa tentar salvar e perder o que escreveu; ficar preso em "offline" depois
 * que ela voltou esconde que já dá para trabalhar.
 *
 * O estado inicial vem de `navigator.onLine` — quem abre a aba já sem rede não
 * pode ver "ao vivo" até o primeiro evento — e as transições vêm só dos eventos
 * do `window`. Um listener registrado duas vezes, ou nunca removido, desalinha o
 * indicador do navegador sem nenhum erro visível.
 */

function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
}

function announce(eventName: 'online' | 'offline'): void {
  act(() => {
    window.dispatchEvent(new Event(eventName));
  });
}

beforeEach(() => {
  setNavigatorOnline(true);
});

afterEach(() => {
  // O `navigator` é global: sem restaurar, o próximo arquivo herdaria a rede
  // derrubada deste teste.
  setNavigatorOnline(true);
});

describe('useOnlineStatus', () => {
  it('começa online quando o navegador está online', () => {
    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(true);
  });

  it('começa offline quando a aba foi aberta sem rede', () => {
    setNavigatorOnline(false);

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(false);
  });

  it('passa a offline quando o navegador avisa que a rede caiu', () => {
    const { result } = renderHook(() => useOnlineStatus());

    setNavigatorOnline(false);
    announce('offline');

    expect(result.current).toBe(false);
  });

  it('volta a online quando a conexão é restabelecida', () => {
    setNavigatorOnline(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);

    setNavigatorOnline(true);
    announce('online');

    expect(result.current).toBe(true);
  });

  it('acompanha várias quedas e reconexões na mesma aba', () => {
    const { result } = renderHook(() => useOnlineStatus());

    setNavigatorOnline(false);
    announce('offline');
    expect(result.current).toBe(false);

    setNavigatorOnline(true);
    announce('online');
    expect(result.current).toBe(true);

    setNavigatorOnline(false);
    announce('offline');
    expect(result.current).toBe(false);
  });

  it('registra um listener por evento e remove os dois ao desmontar', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useOnlineStatus());
    unmount();

    const removidos = removeSpy.mock.calls.map((call) => call[0]);
    expect(removidos).toContain('online');
    expect(removidos).toContain('offline');
  });
});
