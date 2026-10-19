import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { delay, HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createQueryClient } from '@/lib/queryClient';
import { createIncidentFixture } from '@/test/factories';
import { server } from '@/test/setup';

import type { Incident } from '../types';
import {
  LOCATION_MIN_CHARS,
  LOCATION_STALE_TIME_MS,
  LOCATION_SUGGESTION_LIMIT,
  useLocationSuggestions,
} from './useLocationSuggestions';

/**
 * Sugestões de local do formulário de cadastro.
 *
 * O que este teste protege: a cota de leitura do backend (60 por minuto por
 * cliente) e a coerência da lista. Sugestão é o padrão que mais dispara
 * requisição, e cada proteção existe por um motivo medido:
 *
 *  - **mínimo de dois caracteres**: com um só, a API devolveria quase a base
 *    inteira — uma "sugestão" que não reduz nada;
 *  - **debounce**: sete teclas não podem virar sete consultas;
 *  - **resposta fora de ordem**: a resposta lenta do termo antigo chegando depois
 *    não pode apagar a lista do termo novo (a chave de cache é a proteção, não o
 *    `AbortController`);
 *  - **staleTime de um minuto**: apagar e digitar a mesma letra de novo não pode
 *    custar uma segunda consulta.
 *
 * Os testes usam o MSW, e não um mock de módulo: o alvo é justamente o
 * comportamento observável do hook — o que sai na rede e o que volta para a tela.
 */

interface RespostaDeLocal {
  items: readonly Incident[];
  /** Atraso artificial: é o que permite montar a corrida entre dois termos. */
  delayMs?: number;
}

interface Consulta {
  search: string;
  limit: string;
}

const consultas: Consulta[] = [];

/** Monta incidentes com os locais informados, na ordem. */
function locais(...labels: readonly (string | null)[]): Incident[] {
  return labels.map((label, indice) =>
    createIncidentFixture({ id: `inc-${String(indice)}`, locationLabel: label }),
  );
}

function serveLocations(
  porTermo: Record<string, RespostaDeLocal>,
  padrao: RespostaDeLocal = { items: [] },
): void {
  server.use(
    http.get('*/incidents', async ({ request }) => {
      const url = new URL(request.url);
      const termo = url.searchParams.get('search') ?? '';
      consultas.push({ search: termo, limit: url.searchParams.get('limit') ?? '' });

      const resposta = porTermo[termo.toLowerCase()] ?? padrao;
      if (resposta.delayMs !== undefined && resposta.delayMs > 0) {
        await delay(resposta.delayMs);
      }
      return HttpResponse.json({
        items: resposta.items,
        pageInfo: { nextCursor: null, hasNextPage: false, limit: LOCATION_SUGGESTION_LIMIT },
        meta: { total: resposta.items.length, appliedFilters: {} },
      });
    }),
  );
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderSuggestions(
  initial: { term: string; enabled: boolean },
  client = createQueryClient(),
) {
  return renderHook(
    ({ term, enabled }: { term: string; enabled: boolean }) =>
      useLocationSuggestions(term, enabled),
    { initialProps: initial, wrapper: createWrapper(client) },
  );
}

/**
 * Espera de relógio real, para as asserções de **ausência**.
 *
 * `waitFor` só sabe esperar por algo que apareça; provar que nada saiu exige
 * deixar o tempo passar.
 */
async function esperar(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

beforeEach(() => {
  consultas.length = 0;
});

describe('useLocationSuggestions — quando consultar', () => {
  it('não consulta com menos de dois caracteres', async () => {
    serveLocations({ b: { items: locais('BR-116 km 412') } });
    const { result, rerender } = renderSuggestions({ term: '', enabled: true });

    rerender({ term: 'B', enabled: true });
    await esperar(450);

    expect(LOCATION_MIN_CHARS).toBe(2);
    expect(consultas).toHaveLength(0);
    expect(result.current).toEqual([]);
  });

  it('não consulta quando o termo é só espaço', async () => {
    serveLocations({}, { items: locais('BR-116 km 412') });
    const { rerender } = renderSuggestions({ term: '', enabled: true });

    rerender({ term: '  ', enabled: true });
    await esperar(450);

    expect(consultas).toHaveLength(0);
  });

  it('não consulta com o formulário fechado, mesmo com termo válido', async () => {
    serveLocations({ 'br-1': { items: locais('BR-116 km 412') } });
    const { result } = renderSuggestions({ term: 'BR-1', enabled: false });

    await esperar(450);

    expect(consultas).toHaveLength(0);
    expect(result.current).toEqual([]);
  });

  it('pede cinco sugestões por consulta', async () => {
    serveLocations({ 'br-1': { items: locais('BR-116 km 412') } });
    const { result } = renderSuggestions({ term: 'BR-1', enabled: true });

    await waitFor(() => {
      expect(result.current).toEqual(['BR-116 km 412']);
    });

    // Cinco cabem na tela sem rolar: pedir mais seria trazer dado sem leitor.
    expect(consultas).toEqual([{ search: 'BR-1', limit: String(LOCATION_SUGGESTION_LIMIT) }]);
  });
});

describe('useLocationSuggestions — debounce', () => {
  it('digitar rápido produz uma consulta só, com o termo final', async () => {
    serveLocations({ 'br-1': { items: locais('BR-116 km 412') } });
    const { result, rerender } = renderSuggestions({ term: '', enabled: true });

    for (const term of ['B', 'BR', 'BR-', 'BR-1']) {
      rerender({ term, enabled: true });
      await esperar(20);
    }

    await waitFor(() => {
      expect(result.current).toEqual(['BR-116 km 412']);
    });

    expect(consultas).toEqual([{ search: 'BR-1', limit: String(LOCATION_SUGGESTION_LIMIT) }]);
  });

  it('só consulta depois do atraso, nunca a cada tecla', async () => {
    serveLocations({});
    const { rerender } = renderSuggestions({ term: '', enabled: true });

    rerender({ term: 'BR', enabled: true });
    await esperar(120);

    // Ainda dentro do atraso: nada saiu.
    expect(consultas).toHaveLength(0);

    await waitFor(() => {
      expect(consultas).toHaveLength(1);
    });
  });
});

describe('useLocationSuggestions — resposta fora de ordem', () => {
  it('a resposta antiga que chega depois não sobrescreve a nova', async () => {
    // `BR-1` responde devagar; `BR-11`, na hora. A antiga chega por último.
    serveLocations({
      'br-1': { items: locais('BR-1 LOCAL ANTIGO'), delayMs: 500 },
      'br-11': { items: locais('BR-11 LOCAL NOVO'), delayMs: 0 },
    });
    const { result, rerender } = renderSuggestions({ term: 'BR-1', enabled: true });

    // Espera a primeira consulta SAIR de verdade: sem isto o debounce juntaria
    // as duas digitações numa consulta só e a corrida nunca aconteceria.
    await waitFor(
      () => {
        expect(consultas.map((consulta) => consulta.search)).toContain('BR-1');
      },
      { timeout: 3000 },
    );

    rerender({ term: 'BR-11', enabled: true });
    await waitFor(
      () => {
        expect(result.current).toEqual(['BR-11 LOCAL NOVO']);
      },
      { timeout: 3000 },
    );

    // Dá tempo de a resposta atrasada de `BR-1` chegar e tentar entrar na tela.
    await esperar(700);

    expect(result.current).toEqual(['BR-11 LOCAL NOVO']);
    expect(consultas).toHaveLength(2);
  });

  it('a consulta antiga não é reaproveitada ao voltar para o termo anterior', async () => {
    serveLocations({
      'br-1': { items: locais('BR-1 LOCAL ANTIGO'), delayMs: 400 },
      'br-11': { items: locais('BR-11 LOCAL NOVO') },
    });
    const { result, rerender } = renderSuggestions({ term: 'BR-1', enabled: true });
    await waitFor(
      () => {
        expect(consultas).toHaveLength(1);
      },
      { timeout: 3000 },
    );

    rerender({ term: 'BR-11', enabled: true });
    await waitFor(
      () => {
        expect(result.current).toEqual(['BR-11 LOCAL NOVO']);
      },
      { timeout: 3000 },
    );
    await esperar(500);

    // Cada termo tem a própria entrada: a resposta de `BR-1` gravou na entrada
    // de `BR-1`, que ninguém está lendo.
    expect(result.current).toEqual(['BR-11 LOCAL NOVO']);
  });
});

describe('useLocationSuggestions — o que a lista mostra', () => {
  it('deduplica locais repetidos', async () => {
    serveLocations({
      'br-1': { items: locais('BR-116 km 412', 'BR-116 km 412', 'BR-101 km 88') },
    });
    const { result } = renderSuggestions({ term: 'BR-1', enabled: true });

    await waitFor(() => {
      expect(result.current).toEqual(['BR-116 km 412', 'BR-101 km 88']);
    });
  });

  it('descarta local vazio ou só espaço, sem descartar o resto da lista', async () => {
    serveLocations({
      'br-1': { items: locais(null, '   ', 'BR-101 km 88') },
    });
    const { result } = renderSuggestions({ term: 'BR-1', enabled: true });

    // Duas entradas em branco na lista fariam a pessoa duvidar de qual escolher.
    await waitFor(() => {
      expect(result.current).toEqual(['BR-101 km 88']);
    });
  });

  it('sem sugestões devolve lista vazia, e não `undefined`', async () => {
    serveLocations({});
    const { result } = renderSuggestions({ term: 'ZZ-9', enabled: true });

    await waitFor(() => {
      expect(consultas).toHaveLength(1);
    });

    // O componente faz `locais.map(...)`: `undefined` derrubaria a renderização.
    expect(result.current).toEqual([]);
  });

  it('apara o espaço do local antes de sugerir', async () => {
    serveLocations({ 'br-1': { items: locais('  BR-116 km 412  ') } });
    const { result } = renderSuggestions({ term: 'BR-1', enabled: true });

    await waitFor(() => {
      expect(result.current).toEqual(['BR-116 km 412']);
    });
  });
});

describe('useLocationSuggestions — cache', () => {
  it('não reconsulta o mesmo termo dentro do staleTime', async () => {
    serveLocations({ 'br-1': { items: locais('BR-116 km 412') } });
    const client = createQueryClient();
    const { result, unmount } = renderSuggestions({ term: 'BR-1', enabled: true }, client);

    await waitFor(() => {
      expect(result.current).toEqual(['BR-116 km 412']);
    });
    expect(consultas).toHaveLength(1);

    // Reabrir o formulário com o mesmo texto não pode custar consulta nova.
    unmount();
    const segunda = renderSuggestions({ term: 'BR-1', enabled: true }, client);
    await waitFor(() => {
      expect(segunda.result.current).toEqual(['BR-116 km 412']);
    });
    await esperar(400);

    expect(LOCATION_STALE_TIME_MS).toBeGreaterThan(0);
    expect(consultas).toHaveLength(1);
  });

  it('trata o mesmo termo em caixa diferente como a mesma entrada', async () => {
    serveLocations({ 'br-1': { items: locais('BR-116 km 412') } });
    const client = createQueryClient();
    const { result, rerender } = renderSuggestions({ term: 'BR-1', enabled: true }, client);

    await waitFor(() => {
      expect(result.current).toEqual(['BR-116 km 412']);
    });

    rerender({ term: 'br-1', enabled: true });
    await esperar(400);

    // A chave é o termo normalizado: a busca da API já ignora caixa, então
    // consultar de novo por `br-1` seria pagar duas vezes pelo mesmo resultado.
    expect(consultas).toHaveLength(1);
    expect(result.current).toEqual(['BR-116 km 412']);
  });

  it('termos diferentes não compartilham entrada', async () => {
    serveLocations({
      'br-1': { items: locais('BR-116 km 412') },
      'br-101': { items: locais('BR-101 km 88') },
    });
    const { result, rerender } = renderSuggestions({ term: 'BR-1', enabled: true });

    await waitFor(() => {
      expect(result.current).toEqual(['BR-116 km 412']);
    });

    rerender({ term: 'BR-101', enabled: true });

    await waitFor(() => {
      expect(result.current).toEqual(['BR-101 km 88']);
    });
    expect(consultas.map((consulta) => consulta.search)).toEqual(['BR-1', 'BR-101']);
  });
});
