import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { createQueryClient } from '@/lib/queryClient';
import { server } from '@/test/setup';

import { IncidentTimeline } from './IncidentTimeline';

/**
 * Histórico de auditoria no drawer.
 *
 * **O que este arquivo protege.** O endpoint `GET /incidents/{id}/events` existia,
 * era testado e documentado — e o drawer não o consumia. O buraco não era de
 * código, era de integração: metade da funcionalidade pronta e invisível para
 * quem usa. Estes testes existem para que ela não volte a ficar sem consumidor.
 */

const ID = '0f2c7a10-0000-4000-8000-000000000123';

function serveEventos(items: readonly Record<string, unknown>[]): void {
  server.use(http.get(`*/incidents/${ID}/events`, () => HttpResponse.json({ items })));
}

function renderTimeline(incidentId: string | null = ID): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <IncidentTimeline incidentId={incidentId} />
    </QueryClientProvider>,
  );
}

const CRIACAO = {
  id: 'evento-1',
  eventType: 'CREATED',
  fromStatus: null,
  toStatus: 'ABERTO',
  actor: 'Ana Paula Ribeiro',
  payload: null,
  createdAt: '2026-03-10T12:00:00Z',
};

const TRANSICAO = {
  id: 'evento-2',
  eventType: 'STATUS_CHANGED',
  fromStatus: 'ABERTO',
  toStatus: 'EM_INVESTIGACAO',
  actor: 'Carlos Eduardo Lima',
  payload: { expectedVersion: 1 },
  createdAt: '2026-03-10T12:00:00Z',
};

describe('IncidentTimeline', () => {
  it('mostra os eventos na ordem devolvida pelo servidor', async () => {
    serveEventos([CRIACAO, TRANSICAO]);
    renderTimeline();

    expect(await screen.findByText(/Incidente registrado/)).toBeInTheDocument();
    expect(screen.getByText(/Status alterado/)).toBeInTheDocument();

    // A ordem do DOM tem que ser a do servidor. Reordenar por `createdAt` aqui
    // reintroduziria o defeito da #116: os dois eventos têm o MESMO instante de
    // propósito, e o desempate por id é sorteado.
    const itens = screen.getAllByRole('listitem');
    expect(itens[0]).toHaveTextContent('Incidente registrado');
    expect(itens[1]).toHaveTextContent('Status alterado');
  });

  it('diz de qual status para qual status a transição foi', async () => {
    serveEventos([TRANSICAO]);
    renderTimeline();

    // Sem os dois lados, "Status alterado" não informa nada — o histórico
    // precisa dizer de onde veio e para onde foi.
    expect(await screen.findByText(/Aberto → Em Investigação/)).toBeInTheDocument();
  });

  it('mostra o autor e a versão esperada, que explicam a decisão', async () => {
    serveEventos([TRANSICAO]);
    renderTimeline();

    expect(await screen.findByText(/Carlos Eduardo Lima/)).toBeInTheDocument();
    expect(screen.getByText(/versão esperada 1/)).toBeInTheDocument();
  });

  it('avisa quando não há evento, em vez de mostrar área vazia', async () => {
    serveEventos([]);
    renderTimeline();

    expect(await screen.findByText(/Nenhum evento registrado/)).toBeInTheDocument();
  });

  it('não busca nada quando não há incidente selecionado', () => {
    // O drawer fica montado mesmo fechado: sem esta guarda, cada fechamento
    // dispararia uma leitura de histórico que ninguém vai olhar.
    let pedidos = 0;
    server.use(
      http.get(`*/incidents/${ID}/events`, () => {
        pedidos += 1;
        return HttpResponse.json({ items: [] });
      }),
    );

    renderTimeline(null);

    expect(pedidos).toBe(0);
    // Não renderiza nada — "nenhum evento registrado" seria mentira, porque
    // ninguém perguntou nada ainda.
    expect(screen.queryByText(/Histórico/)).not.toBeInTheDocument();
  });

  it('não derruba o drawer quando o histórico falha', async () => {
    // 4xx e não 503: o retry do cache repete 5xx, e o teste ficaria esperando a
    // política de retry em vez de verificar o que interessa.
    server.use(
      http.get(`*/incidents/${ID}/events`, () =>
        HttpResponse.json(
          { error: { code: 'INCIDENT_NOT_FOUND', message: 'não encontrado' } },
          { status: 404 },
        ),
      ),
    );
    renderTimeline();

    // Um histórico indisponível é um detalhe a menos — não pode esconder o caso.
    expect(await screen.findByText(/Não foi possível carregar o histórico/)).toBeInTheDocument();
  });
});
