import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatSlaRemaining, parseDate, slaTone, type SlaTone } from '@/lib/formatters';
import { cn } from '@/lib/utils';

import { isClosedStatus, type IncidentStatus } from '../types';

const TONE_CLASSES: Record<SlaTone, string> = {
  ok: 'text-fg-muted',
  warning: 'text-warning-text',
  danger: 'text-danger-text font-semibold',
  overdue: 'text-danger-text font-bold',
  done: 'text-fg-subtle',
};

const TONE_LABELS: Record<SlaTone, string> = {
  ok: 'dentro do prazo',
  warning: 'prazo se aproximando',
  danger: 'prazo crítico',
  overdue: 'SLA estourado',
  done: 'incidente encerrado',
};

const TICK_MS = 30_000;

export interface SlaTimerProps {
  slaDueAt: string;
  status: IncidentStatus;
  className?: string;
}

/** Timer de SLA com `tabular-nums` e cor progressiva (não depende só da cor: há texto). */
export function SlaTimer({ slaDueAt, status, className }: SlaTimerProps) {
  const [now, setNow] = useState<number>(() => Date.now());
  const closed = isClosedStatus(status);

  useEffect(() => {
    if (closed) return;
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      window.clearInterval(interval);
    };
  }, [closed]);

  const dueDate = parseDate(slaDueAt);
  if (dueDate === null) {
    return (
      <span className={cn('text-2xs text-fg-subtle', className)} data-testid="sla-timer">
        SLA não definido
      </span>
    );
  }

  const remainingMs = dueDate.getTime() - now;
  const tone = slaTone(remainingMs, closed);
  const label = formatSlaRemaining(remainingMs);

  return (
    <span
      data-testid="sla-timer"
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 font-mono text-2xs nums',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{`SLA ${TONE_LABELS[tone]}: `}</span>
      {closed ? `SLA ${label}` : label}
    </span>
  );
}
