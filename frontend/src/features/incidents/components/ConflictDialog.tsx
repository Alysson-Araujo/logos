import { useQueryClient } from '@tanstack/react-query';
import { Copy, RefreshCw, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/useToast';
import { formatDateTime, formatRelative } from '@/lib/formatters';
import { cn, copyTextToClipboard } from '@/lib/utils';

import { incidentQueryKeys } from '../hooks/useIncidents';
import { useIncidentUiStore } from '../hooks/useIncidentUiStore';
import { STATUS_LABELS } from '../labels';
import type { ConflictState } from '../types';

interface DiffRow {
  label: string;
  attempted: string;
  server: string;
  changed: boolean;
}

/** Diff campo a campo: "você tentou X · no servidor está Y" (seção 7.4). */
export function buildConflictDiffRows(conflict: ConflictState): DiffRow[] {
  const { attempted, server } = conflict;
  const attemptedNotes = attempted.resolutionNotes ?? '—';
  const serverNotes = server.resolutionNotes ?? '—';
  const attemptedVersion = `v${String(attempted.viewedVersion)}`;
  const serverVersion = `v${String(server.version)}`;

  const rows: DiffRow[] = [
    {
      label: 'Status',
      attempted: STATUS_LABELS[attempted.status],
      server: STATUS_LABELS[server.status],
      changed: attempted.status !== server.status,
    },
    {
      label: 'Justificativa',
      attempted: attemptedNotes,
      server: serverNotes,
      changed: attemptedNotes !== serverNotes,
    },
    {
      label: 'Versão',
      attempted: attemptedVersion,
      server: serverVersion,
      changed: attemptedVersion !== serverVersion,
    },
    {
      label: 'Analista responsável',
      attempted: '—',
      server: server.assignedAnalyst ?? '—',
      changed: server.assignedAnalyst !== null,
    },
    {
      label: 'Última atualização no servidor',
      attempted: formatDateTime(attempted.attemptedAt),
      server: `${formatDateTime(server.updatedAt)} (${formatRelative(server.updatedAt)})`,
      changed: false,
    },
  ];

  return rows.filter((row) => row.changed || row.label === 'Status' || row.label === 'Versão');
}

/** Modal do estado `conflict`: nada é sobrescrito sem o analista decidir. */
export function ConflictDialog() {
  const conflict = useIncidentUiStore((state) => state.conflict);
  const closeConflict = useIncidentUiStore((state) => state.closeConflict);
  const queryClient = useQueryClient();
  const pushToast = useToast();
  const [showTechnical, setShowTechnical] = useState(false);

  if (conflict === null) return null;

  const rows = buildConflictDiffRows(conflict);

  const handleReload = (): void => {
    void queryClient.invalidateQueries({ queryKey: incidentQueryKeys.all });
    closeConflict();
    pushToast({
      variant: 'info',
      title: 'Dados recarregados do servidor',
      description: `${conflict.server.code} agora está em ${STATUS_LABELS[conflict.server.status]}.`,
    });
  };

  const handleCopy = (): void => {
    const payload = JSON.stringify(
      {
        code: conflict.server.code,
        requestId: conflict.requestId,
        message: conflict.message,
        attempted: conflict.attempted,
        server: conflict.server,
      },
      null,
      2,
    );
    void copyTextToClipboard(payload).then((copied) => {
      pushToast({
        variant: copied ? 'info' : 'error',
        title: copied ? 'Detalhes do conflito copiados' : 'Não foi possível copiar',
      });
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeConflict();
      }}
    >
      <DialogContent role="alertdialog" aria-labelledby="conflict-title">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-danger" aria-hidden="true">
            <TriangleAlert className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <DialogTitle id="conflict-title">Alguém mudou este incidente antes de você</DialogTitle>
            <DialogDescription className="mt-1">
              {conflict.message} Sua alteração foi desfeita para não sobrescrever o colega.
            </DialogDescription>
          </div>
        </div>

        {/* Região assertiva: interrompe o analista porque houve risco de dado perdido. */}
        <div role="alert" aria-live="assertive" className="flex flex-col gap-2">
          <table className="w-full border-separate border-spacing-0 text-left">
            <caption className="sr-only">
              Comparação entre o que você tentou enviar e o estado atual no servidor
            </caption>
            <thead>
              <tr className="text-2xs uppercase tracking-wide text-fg-subtle">
                <th scope="col" className="pb-1 pr-3 font-semibold">
                  Campo
                </th>
                <th scope="col" className="pb-1 pr-3 font-semibold">
                  Você tentou
                </th>
                <th scope="col" className="pb-1 font-semibold">
                  No servidor está
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="align-top">
                  <th
                    scope="row"
                    className="border-t border-border py-2 pr-3 text-2xs font-semibold text-fg-muted"
                  >
                    {row.label}
                  </th>
                  <td
                    className={cn(
                      'border-t border-border py-2 pr-3 text-xs',
                      row.changed ? 'text-danger-text' : 'text-fg-muted',
                    )}
                  >
                    {row.attempted}
                  </td>
                  <td
                    className={cn(
                      'border-t border-border py-2 text-xs',
                      row.changed ? 'font-semibold text-fg' : 'text-fg-muted',
                    )}
                  >
                    {row.server}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showTechnical ? (
          <pre className="max-h-40 overflow-auto rounded-sm bg-surface-sunken p-3 text-2xs text-fg-muted">
            {JSON.stringify(
              {
                requestId: conflict.requestId,
                code: conflict.server.code,
                viewedVersion: conflict.attempted.viewedVersion,
                serverVersion: conflict.server.version,
              },
              null,
              2,
            )}
          </pre>
        ) : null}

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowTechnical((previous) => !previous);
            }}
          >
            {showTechnical ? 'Ocultar detalhes técnicos' : 'Ver o que mudou'}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleCopy}>
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            Copiar detalhes técnicos
          </Button>
          <Button variant="primary" size="sm" onClick={handleReload}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Recarregar
          </Button>
          <Button variant="ghost" size="sm" onClick={closeConflict}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
