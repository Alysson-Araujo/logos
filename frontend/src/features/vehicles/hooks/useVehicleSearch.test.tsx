import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { createQueryClient } from '@/lib/queryClient';
import { server } from '@/test/setup';

import { PLATE_SUGGESTION_LIMIT } from '../api';
import type { Vehicle, VehicleSearchResult } from '../types';
import { useVehicleSearch } from './useVehicleSearch';

/**
 * Sugestões de placa no campo do formulário de cadastro.
 *
 * O que este teste protege: a cota de leitura da API e a utilidade da lista. A
 * frota é consultada por prefixo, e sem o atraso digitar `ABC1D23` custaria sete
 * requisições — com a agravante de que a resposta lenta de `ABC` poderia chegar
 * depois da de `ABC1D2` e esvaziar a sugestão certa. A outra metade é o
 * `enabled`: buscar a frota a cada formulário aberto e fechado sem uso é
 * requisição que ninguém lê.
 */

const FROTA: Vehicle[] = [
  { id: 'v-1', plate: 'ABC1D23', model: 'Scania R450', carrier: 'Transportes Silva' },
  { id: 'v-2', plate: 'ABC4E56', model: 'Volvo FH 460', carrier: 'Rodo Norte' },
];

interface VehicleCall {
  q: string;
  limit: string;
}

const chamadas: VehicleCall[] = [];

function serveVehicles(resultado: VehicleSearchResult = { items: FROTA, total: 42 }): void {
  server.use(
    http.get('*/vehicles', ({ request }) => {
      const url = new URL(request.url);
      chamadas.push({
        q: url.searchParams.get('q') ?? '',
        limit: url.searchParams.get('limit') ?? '',
      });
      return HttpResponse.json(resultado);
    }),
  );
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function renderSearch(initial: { term: string; enabled: boolean }, client = createQueryClient()) {
  return renderHook(
    ({ term, enabled }: { term: string; enabled: boolean }) => useVehicleSearch(term, enabled),
    { initialProps: initial, wrapper: createWrapper(client) },
  );
}

beforeEach(() => {
  chamadas.length = 0;
});

describe('useVehicleSearch — quando consultar', () => {
  it('não busca a frota com a janela de cadastro fechada', async () => {
    serveVehicles();
    const { result } = renderSearch({ term: 'ABC', enabled: false });

    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });

    expect(chamadas).toHaveLength(0);
    expect(result.current.data).toBeUndefined();
  });

  it('busca com a janela aberta e devolve as placas e o total da frota', async () => {
    serveVehicles();
    const { result } = renderSearch({ term: 'ABC', enabled: true });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.items.map((vehicle) => vehicle.plate)).toEqual([
      'ABC1D23',
      'ABC4E56',
    ]);
    // `total` é o da frota, não o da página: é o que a tela usa para dizer que
    // existem mais sugestões do que as oito mostradas.
    expect(result.current.data?.total).toBe(42);
  });

  it('pede o prefixo digitado e o teto de oito sugestões', async () => {
    serveVehicles();
    const { result } = renderSearch({ term: 'ABC1', enabled: true });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(chamadas).toEqual([{ q: 'ABC1', limit: String(PLATE_SUGGESTION_LIMIT) }]);
  });

  it('com o campo vazio ainda consulta a frota assim que a janela abre', async () => {
    serveVehicles();
    const { result } = renderSearch({ term: '', enabled: true });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Comportamento atual: quem decide é só o `enabled` (a janela aberta), sem
    // guarda de termo vazio — a sugestão inicial é a frota inteira, limitada a
    // oito. O `staleTime` de 30 s evita repetir a consulta a cada reabertura.
    expect(chamadas).toEqual([{ q: '', limit: String(PLATE_SUGGESTION_LIMIT) }]);
  });
});

describe('useVehicleSearch — debounce', () => {
  it('digitar rápido produz uma consulta só, já com o termo final', async () => {
    serveVehicles();
    const { result, rerender } = renderSearch({ term: '', enabled: true });

    for (const term of ['A', 'AB', 'ABC', 'ABC1', 'ABC1D', 'ABC1D2', 'ABC1D23']) {
      rerender({ term, enabled: true });
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    }

    await waitFor(() => {
      expect(result.current.debouncedTerm).toBe('ABC1D23');
    });
    await waitFor(() => {
      expect(chamadas).toHaveLength(2);
    });

    // A primeira consulta é a sugestão inicial (campo vazio, janela aberta); a
    // segunda é a única que as sete teclas produziram. Sem o atraso, seriam sete
    // — uma por tecla.
    expect(chamadas.map((call) => call.q)).toEqual(['', 'ABC1D23']);
  });

  it('devolve o termo atrasado, que é o termo da lista mostrada', async () => {
    serveVehicles();
    const { result, rerender } = renderSearch({ term: 'ABC', enabled: true });

    rerender({ term: 'ABC1', enabled: true });

    // Enquanto o atraso não passa, a tela continua com o resultado de `ABC`:
    // devolver o termo novo aqui faria o componente achar que a lista é de
    // `ABC1` quando ainda é de `ABC`.
    expect(result.current.debouncedTerm).toBe('ABC');

    await waitFor(() => {
      expect(result.current.debouncedTerm).toBe('ABC1');
    });
  });
});

describe('useVehicleSearch — resposta fora do contrato', () => {
  it('vira erro, em vez de uma lista de placas em branco', async () => {
    server.use(
      http.get('*/vehicles', () =>
        HttpResponse.json({ items: [{ id: 'v-9', model: 'Sem placa' }], total: 1 }),
      ),
    );

    const { result } = renderSearch({ term: 'ABC', enabled: true });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // `plate` ausente viraria `undefined` no rótulo da opção: melhor dizer que a
    // resposta não serve do que oferecer uma sugestão sem placa.
    expect(result.current.data).toBeUndefined();
  });
});
