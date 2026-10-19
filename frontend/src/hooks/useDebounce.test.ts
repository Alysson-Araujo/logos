import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEARCH_DEBOUNCE_MS, useDebounce } from './useDebounce';

/**
 * Atraso da busca textual (seção 8.4).
 *
 * O que este teste protege: a cota de leitura da API. O autocomplete consulta a
 * cada mudança de termo, e sem o atraso cada tecla vira uma requisição — digitar
 * `BR-116` custaria seis consultas num backend que aceita sessenta por minuto.
 * O teste mede as duas propriedades de que a cota depende: nada é publicado
 * antes do atraso completo e a digitação rápida colapsa numa atualização só.
 *
 * Relógio falso de propósito: com tempo real, provar que "nada aconteceu durante
 * 300 ms" exigiria dormir 300 ms por asserção e ainda deixaria a suíte exposta a
 * variação de agendamento da máquina.
 */

/** Valores publicados pelo hook, na ordem das renderizações — é a régua do colapso. */
function renderDebounce(initialValue: string, delayMs: number = SEARCH_DEBOUNCE_MS) {
  const published: string[] = [];
  const view = renderHook(
    ({ value }: { value: string }) => {
      const debouncedValue = useDebounce(value, delayMs);
      published.push(debouncedValue);
      return debouncedValue;
    },
    { initialProps: { value: initialValue } },
  );

  return { ...view, published };
}

/** Avança o relógio dentro de `act`: a atualização de estado é do React. */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('entrega o valor inicial na hora, sem esperar o atraso', () => {
    const { result } = renderDebounce('BR-116');

    expect(result.current).toBe('BR-116');
  });

  it('só publica o novo valor depois do atraso completo', () => {
    const { result, rerender } = renderDebounce('BR');

    rerender({ value: 'BR-116' });

    advance(SEARCH_DEBOUNCE_MS - 1);
    expect(result.current).toBe('BR');

    advance(1);
    expect(result.current).toBe('BR-116');
  });

  it('digitação rápida colapsa numa atualização só', () => {
    const { result, rerender, published } = renderDebounce('B');

    for (const value of ['BR', 'BR-', 'BR-1', 'BR-11', 'BR-116']) {
      rerender({ value });
      // Bem menos que o atraso: é assim que se digita.
      advance(20);
    }

    advance(SEARCH_DEBOUNCE_MS);

    expect(result.current).toBe('BR-116');
    // Cinco teclas depois do valor inicial, mas uma transição só: o que a API
    // vê é uma consulta, não cinco.
    const transicoes = published.filter(
      (value, index) => index === 0 || value !== published[index - 1],
    );
    expect(transicoes).toEqual(['B', 'BR-116']);
  });

  it('cada tecla reinicia a contagem, em vez de acumular o tempo já decorrido', () => {
    const { result, rerender } = renderDebounce('B');

    advance(200);
    rerender({ value: 'BR' });
    // 400 ms de relógio: mais que o atraso, mas a contagem recomeçou no `BR`.
    advance(200);
    expect(result.current).toBe('B');

    advance(SEARCH_DEBOUNCE_MS - 200);
    expect(result.current).toBe('BR');
  });

  it('respeita um atraso diferente do padrão', () => {
    const { result, rerender } = renderDebounce('BR', 1000);

    rerender({ value: 'BR-116' });

    advance(999);
    expect(result.current).toBe('BR');

    advance(1);
    expect(result.current).toBe('BR-116');
  });

  it('não deixa timer pendente quando o componente sai de tela', () => {
    const { rerender, unmount } = renderDebounce('BR');
    rerender({ value: 'BR-116' });

    unmount();

    // Um timer sobrevivente chamaria `setState` num componente desmontado — em
    // produção, o aviso do React; aqui, a prova de que o `clearTimeout` existe.
    expect(vi.getTimerCount()).toBe(0);
  });
});
