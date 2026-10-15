import { Clock, Flag, MapPin, Radio, Truck, User, UserCheck, Wrench } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerCloseButton,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatCoordinates,
  formatDateTime,
  formatFullDateTime,
  formatPlate,
  formatRelative,
  formatVersion,
  slaConsumedPercent,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';

import type { ChangeStatusMutation } from '../hooks/useIncidentMutations';
import { useIncidentDetail } from '../hooks/useIncidents';
import { CATEGORY_LABELS, STATUS_LABELS, TRANSITION_ACTION_LABELS } from '../labels';
import { explainPriority } from '../priority';
import { firstIssueMessage, statusChangeRequestSchema } from '../schemas';
import { getAllowedTransitions } from '../statusMachine';
import { isClosedStatus, requiresResolutionNotes, type IncidentStatus } from '../types';
import { CriticalityBadge } from './CriticalityBadge';
import { SlaTimer } from './SlaTimer';
import { StatusBadge } from './StatusBadge';

export interface IncidentDrawerProps {
  incidentId: string | null;
  mutation: ChangeStatusMutation;
  onClose: () => void;
}

/** Drawer de detalhe com transições permitidas, otimismo e justificativa obrigatória. */
export function IncidentDrawer({ incidentId, mutation, onClose }: IncidentDrawerProps) {
  const detailQuery = useIncidentDetail(incidentId);
  const detail = detailQuery.data;
  const incident = detail?.incident ?? null;

  const [targetStatus, setTargetStatus] = useState<IncidentStatus | null>(null);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setTargetStatus(null);
    setNotes('');
    setFormError(null);
  }, [incidentId]);

  const isPendingHere = mutation.isPending && mutation.variables.id === incidentId;

  const submitTransition = (status: IncidentStatus, resolutionNotes: string | undefined): void => {
    if (incident === null) return;
    mutation.mutate({
      id: incident.id,
      status,
      resolutionNotes,
      version: incident.version,
      scope: `${incident.id}:${status}`,
    });
    setTargetStatus(null);
    setNotes('');
    setFormError(null);
  };

  const handleTransition = (status: IncidentStatus): void => {
    if (requiresResolutionNotes(status)) {
      setTargetStatus(status);
      setFormError(null);
      return;
    }
    submitTransition(status, undefined);
  };

  const handleConfirmWithNotes = (): void => {
    if (targetStatus === null) return;
    const parsed = statusChangeRequestSchema.safeParse({
      status: targetStatus,
      resolutionNotes: notes,
    });
    if (!parsed.success) {
      setFormError(firstIssueMessage(parsed.error));
      return;
    }
    submitTransition(targetStatus, notes.trim());
  };

  return (
    <Drawer
      open={incidentId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent aria-busy={isPendingHere}>
        {incidentId === null ? null : detailQuery.isLoading ? (
          <DrawerSkeleton onClose={onClose} />
        ) : incident === null ? (
          <div className="p-4">
            <ErrorState
              variant="recoverable"
              error={detailQuery.error}
              onRetry={() => {
                void detailQuery.refetch();
              }}
              isRetrying={detailQuery.isFetching}
            />
          </div>
        ) : (
          <>
            <header className="flex items-start gap-3 border-b border-border p-4">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <DrawerTitle className="font-mono text-sm nums">{incident.code}</DrawerTitle>
                  <CriticalityBadge criticality={incident.criticality} size="sm" />
                  {isPendingHere ? (
                    <Badge tone="info">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      enviando…
                    </Badge>
                  ) : null}
                </div>
                <DrawerDescription className="mt-1">
                  {CATEGORY_LABELS[incident.category]} · score {incident.priorityScore} ·{' '}
                  {formatVersion(incident.version)} · aberto {formatRelative(incident.createdAt)}
                </DrawerDescription>
                <p className="mt-2 text-sm font-medium text-fg">{incident.title}</p>
              </div>
              <DrawerCloseButton onClose={onClose} />
            </header>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              <section className="flex flex-col gap-3 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Status
                  </span>
                  <StatusBadge status={incident.status} />
                  <span className="font-mono text-2xs nums text-fg-subtle">
                    {formatVersion(incident.version)} · lock por If-Match
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {getAllowedTransitions(incident.status).map((status) => (
                    <Button
                      key={status}
                      size="sm"
                      variant={status === 'FECHADO' ? 'primary' : 'secondary'}
                      disabled={isPendingHere}
                      onClick={() => {
                        handleTransition(status);
                      }}
                    >
                      {TRANSITION_ACTION_LABELS[status]}
                    </Button>
                  ))}
                  {getAllowedTransitions(incident.status).length === 0 ? (
                    <p className="text-2xs text-fg-subtle">
                      FECHADO é terminal — reabrir exige um novo incidente vinculado.
                    </p>
                  ) : null}
                </div>

                {targetStatus === null ? null : (
                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    <label
                      className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle"
                      htmlFor="resolution-notes"
                    >
                      {`Justificativa obrigatória para ${STATUS_LABELS[targetStatus]} (mín. 10 caracteres)`}
                    </label>
                    <textarea
                      id="resolution-notes"
                      rows={3}
                      value={notes}
                      aria-invalid={formError !== null}
                      aria-describedby={formError === null ? undefined : 'resolution-notes-error'}
                      onChange={(event) => {
                        setNotes(event.target.value);
                      }}
                      className="w-full rounded-sm border border-border bg-surface p-2 text-sm text-fg placeholder:text-fg-subtle"
                      placeholder="Descreva o que foi apurado, quem foi acionado e o desfecho."
                    />
                    {formError === null ? null : (
                      <p
                        id="resolution-notes-error"
                        role="alert"
                        className="text-2xs text-danger-text"
                      >
                        {formError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={isPendingHere}
                        onClick={handleConfirmWithNotes}
                      >
                        Confirmar mudança
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setTargetStatus(null);
                          setNotes('');
                          setFormError(null);
                        }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
                    SLA
                  </span>
                  <SlaTimer slaDueAt={incident.slaDueAt} status={incident.status} />
                </div>
                <SlaBar incident={incident} />
                <p className="text-2xs text-fg-subtle">
                  Vence em {formatFullDateTime(incident.slaDueAt)}
                </p>
              </section>

              <section className="flex flex-col gap-2">
                <h4 className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
                  Operação
                </h4>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DetailRow
                    icon={<MapPin className="h-3.5 w-3.5" aria-hidden="true" />}
                    label="Local"
                    value={incident.locationLabel ?? 'Não informado'}
                    hint={formatCoordinates(incident.latitude, incident.longitude)}
                  />
                  <DetailRow
                    icon={<Truck className="h-3.5 w-3.5" aria-hidden="true" />}
                    label="Placa"
                    value={formatPlate(incident.truckPlate)}
                    mono
                  />
                  <DetailRow
                    icon={<User className="h-3.5 w-3.5" aria-hidden="true" />}
                    label="Motorista"
                    value={incident.driverName ?? 'Não informado'}
                  />
                  <DetailRow
                    icon={<Radio className="h-3.5 w-3.5" aria-hidden="true" />}
                    label="Reportado por"
                    value={incident.reportedBy}
                  />
                  <DetailRow
                    icon={<UserCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                    label="Analista responsável"
                    value={incident.assignedAnalyst ?? 'Sem responsável'}
                  />
                  <DetailRow
                    icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}
                    label="Criado em"
                    value={formatDateTime(incident.createdAt)}
                    hint={formatRelative(incident.createdAt)}
                  />
                  <DetailRow
                    icon={<Flag className="h-3.5 w-3.5" aria-hidden="true" />}
                    label="Encerrado em"
                    value={
                      incident.closedAt === null
                        ? 'Em andamento'
                        : formatDateTime(incident.closedAt)
                    }
                  />
                  <DetailRow
                    icon={<Wrench className="h-3.5 w-3.5" aria-hidden="true" />}
                    label="Atualizado em"
                    value={formatDateTime(incident.updatedAt)}
                    hint={formatRelative(incident.updatedAt)}
                  />
                </dl>
              </section>

              <section className="flex flex-col gap-2">
                <h4 className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
                  Por que esta prioridade?
                </h4>
                <ul className="flex flex-col gap-1 rounded-md bg-surface-sunken p-3">
                  {explainPriority(incident).reasons.map((reason) => (
                    <li key={reason} className="text-2xs text-fg-muted">
                      {reason}
                    </li>
                  ))}
                  <li className="mt-1 border-t border-border pt-1 font-mono text-2xs nums text-fg">
                    score {incident.priorityScore}
                  </li>
                </ul>
              </section>

              {incident.description === null ? null : (
                <section className="flex flex-col gap-1">
                  <h4 className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Descrição
                  </h4>
                  <p className="text-xs text-fg-muted">{incident.description}</p>
                </section>
              )}

              {incident.resolutionNotes === null ? null : (
                <section className="flex flex-col gap-1">
                  <h4 className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
                    Justificativa registrada
                  </h4>
                  <p className="rounded-md bg-success-soft p-3 text-xs text-success-text">
                    {incident.resolutionNotes}
                  </p>
                </section>
              )}
            </div>

            <footer className="border-t border-border px-4 py-3 text-2xs text-fg-subtle">
              <span className="font-mono nums">
                ETag {detail?.etag ?? '—'} · atualizado {formatRelative(incident.updatedAt)}
              </span>
            </footer>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function SlaBar({
  incident,
}: {
  incident: {
    createdAt: string;
    slaDueAt: string;
    closedAt: string | null;
    status: IncidentStatus;
  };
}) {
  const consumed = slaConsumedPercent(incident.createdAt, incident.slaDueAt, incident.closedAt);
  const closed = isClosedStatus(incident.status);

  return (
    <div
      role="progressbar"
      aria-label="Consumo do SLA"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={consumed}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-panel ease-panel',
          closed
            ? 'bg-status-fechado'
            : consumed >= 100
              ? 'bg-danger'
              : consumed >= 75
                ? 'bg-warning'
                : 'bg-success',
        )}
        style={{ width: `${String(consumed)}%` }}
      />
    </div>
  );
}

interface DetailRowProps {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}

function DetailRow({ icon, label, value, hint, mono = false }: DetailRowProps) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-fg-subtle">{icon}</span>
      <div className="min-w-0">
        <dt className="text-2xs uppercase tracking-wide text-fg-subtle">{label}</dt>
        <dd className={cn('text-xs text-fg', mono ? 'font-mono nums' : null)}>{value}</dd>
        {hint === undefined ? null : <p className="text-2xs text-fg-subtle">{hint}</p>}
      </div>
    </div>
  );
}

function DrawerSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-64" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <DrawerCloseButton onClose={onClose} />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-12 w-full" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
