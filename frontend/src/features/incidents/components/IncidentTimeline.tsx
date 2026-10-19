import { CirclePlus, CircleSlash, Clock, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';

import { useIncidentEvents } from '../hooks/useIncidentEvents';
import { STATUS_LABELS } from '../labels';
import type { IncidentEvent, IncidentStatus } from '../types';

/**
 * Ícone e rótulo por tipo de evento.
 *
 * Três canais redundantes (ícone + cor + texto), como no resto do design system.
 * Um tipo novo no servidor cai no caso padrão em vez de quebrar a renderização —
 * é por isso que `eventType` é `string` no schema, e não enum.
 */
const EVENTO: Record<string, { icon: typeof Clock; label: string; className: string }> = {
  CREATED: { icon: CirclePlus, label: 'Incidente registrado', className: 'text-info-text' },
  STATUS_CHANGED: { icon: RefreshCw, label: 'Status alterado', className: 'text-accent' },
  DELETED: { icon: CircleSlash, label: 'Incidente removido', className: 'text-danger-text' },
};

const PADRAO = { icon: Clock, label: 'Evento', className: 'text-fg-muted' };

const formatador = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function rotuloDeStatus(status: IncidentStatus | null): string {
  return status === null ? '—' : STATUS_LABELS[status];
}

/** Uma linha do histórico. */
function TimelineRow({ event }: { event: IncidentEvent }) {
  const meta = EVENTO[event.eventType] ?? PADRAO;
  const Icon = meta.icon;

  // A versão vista fica no payload da transição: mostrá-la é o que permite
  // explicar depois por que uma mudança foi aceita e outra recusada.
  const versaoEsperada = event.payload?.expectedVersion;

  return (
    <li className="flex gap-3">
      <span className="relative flex flex-col items-center">
        <Icon className={cn('h-4 w-4 shrink-0', meta.className)} aria-hidden="true" />
        <span className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
      </span>

      <div className="flex flex-1 flex-col gap-0.5 pb-3">
        <p className="text-xs font-medium text-fg">
          {meta.label}
          {event.fromStatus === null && event.toStatus === null ? null : (
            <span className="font-normal text-fg-muted">
              {' '}
              — {rotuloDeStatus(event.fromStatus)} → {rotuloDeStatus(event.toStatus)}
            </span>
          )}
        </p>

        <p className="text-2xs text-fg-subtle">
          {event.actor ?? 'autor não registrado'} ·{' '}
          <time dateTime={event.createdAt}>{formatador.format(new Date(event.createdAt))}</time>
          {typeof versaoEsperada === 'number' ? ` · versão esperada ${String(versaoEsperada)}` : ''}
        </p>
      </div>
    </li>
  );
}

export interface IncidentTimelineProps {
  incidentId: string | null;
}

/**
 * Histórico de auditoria no drawer de detalhe.
 *
 * **O endpoint existia e a interface não o usava.** `GET /incidents/{id}/events`
 * estava implementado, testado e documentado desde a autenticação — e o drawer
 * não tinha timeline. Isto é o que fecha essa lacuna.
 *
 * A ordem é a do servidor. Reordenar por `createdAt` no cliente reintroduziria o
 * defeito que a coluna `sequence` resolveu: dois eventos no mesmo milissegundo
 * empatam, e o desempate por id é sorteado.
 */
export function IncidentTimeline({ incidentId }: IncidentTimelineProps) {
  const { events, isLoading, isError } = useIncidentEvents(incidentId);

  // Sem incidente selecionado não há histórico a mostrar — e "nenhum evento
  // registrado" seria mentira: ninguém perguntou nada ainda. O drawer fica
  // montado mesmo fechado, então este caminho é alcançado de verdade.
  if (incidentId === null) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-2xs font-semibold uppercase tracking-[0.025em] text-fg-muted">
        Histórico
      </h3>

      {isLoading ? (
        <p className="text-xs text-fg-subtle">Carregando histórico…</p>
      ) : isError ? (
        // Um histórico indisponível não pode esconder o incidente: avisa e segue.
        <p className="text-xs text-fg-subtle">
          Não foi possível carregar o histórico agora. O restante do caso continua válido.
        </p>
      ) : events.length === 0 ? (
        <p className="text-xs text-fg-subtle">Nenhum evento registrado.</p>
      ) : (
        <ol className="flex flex-col">
          {events.map((event) => (
            <TimelineRow key={event.id} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}
