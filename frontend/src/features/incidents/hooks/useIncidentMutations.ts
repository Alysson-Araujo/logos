import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useRef } from 'react';

import { useToast } from '@/hooks/useToast';
import { createIdempotencyKey, isApiError, isVersionConflict } from '@/lib/http';

import {
  changeIncidentStatus,
  readConflictServerState,
  type IncidentDetailResult,
} from '../api/endpoints';
import { STATUS_LABELS } from '../labels';
import type { ConflictState, Incident, IncidentListResponse, IncidentStatus } from '../types';
import { useIncidentUiStore } from './useIncidentUiStore';
import { incidentQueryKeys } from './useIncidents';

export interface ChangeStatusVariables {
  id: string;
  status: IncidentStatus;
  resolutionNotes?: string;
  /** Versão que o analista viu na tela → `If-Match`. */
  version: number;
  /** Chave lógica da tentativa: mantém a `Idempotency-Key` estável no retry manual. */
  scope: string;
}

interface ChangeStatusContext {
  previousDetail: IncidentDetailResult | undefined;
  previousLists: [QueryKey, InfiniteData<IncidentListResponse, string | null> | undefined][];
}

type IncidentListData = InfiniteData<IncidentListResponse, string | null>;

function resolveIdempotencyKey(store: Map<string, string>, scope: string): string {
  const existing = store.get(scope);
  if (existing !== undefined) return existing;
  const created = createIdempotencyKey();
  store.set(scope, created);
  return created;
}

/** Estado `optimisticApplied`: a lista e o detalhe mudam antes do `200`. */
function patchIncidentInCaches(client: QueryClient, id: string, patch: Partial<Incident>): void {
  client.setQueriesData<IncidentListData>({ queryKey: incidentQueryKeys.lists() }, (data) => {
    if (data === undefined) return data;
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      })),
    };
  });

  client.setQueryData<IncidentDetailResult>(incidentQueryKeys.detail(id), (data) => {
    if (data === undefined) return data;
    return { ...data, incident: { ...data.incident, ...patch } };
  });
}

function describeError(error: unknown): string {
  if (isApiError(error)) return error.message;
  return error instanceof Error ? error.message : 'Erro inesperado.';
}

/**
 * Transição de status com atualização otimista, rollback e tratamento de `409`.
 * Mutações não têm retry automático; a idempotência fica na chave estável.
 */
export function useChangeIncidentStatus() {
  const queryClient = useQueryClient();
  const pushToast = useToast();
  const openConflict = useIncidentUiStore((state) => state.openConflict);
  const markUpdated = useIncidentUiStore((state) => state.markUpdated);
  const idempotencyKeys = useRef(new Map<string, string>());

  return useMutation({
    mutationFn: (variables: ChangeStatusVariables) =>
      changeIncidentStatus({
        id: variables.id,
        version: variables.version,
        idempotencyKey: resolveIdempotencyKey(idempotencyKeys.current, variables.scope),
        request: { status: variables.status, resolutionNotes: variables.resolutionNotes },
      }),

    onMutate: async (variables): Promise<ChangeStatusContext> => {
      await queryClient.cancelQueries({ queryKey: incidentQueryKeys.detail(variables.id) });

      const previousDetail = queryClient.getQueryData<IncidentDetailResult>(
        incidentQueryKeys.detail(variables.id),
      );
      const previousLists = queryClient.getQueriesData<IncidentListData>({
        queryKey: incidentQueryKeys.lists(),
      });

      const patch: Partial<Incident> = {
        status: variables.status,
        updatedAt: new Date().toISOString(),
        version: variables.version + 1,
      };
      const notes = variables.resolutionNotes?.trim();
      if (notes !== undefined && notes !== '') patch.resolutionNotes = notes;

      patchIncidentInCaches(queryClient, variables.id, patch);
      return { previousDetail, previousLists };
    },

    onError: (error, variables, context) => {
      if (context !== undefined) {
        context.previousLists.forEach(([key, data]) => {
          queryClient.setQueryData(key, data);
        });
        queryClient.setQueryData(incidentQueryKeys.detail(variables.id), context.previousDetail);
      }

      if (isVersionConflict(error)) {
        const server = readConflictServerState(error);
        if (server !== null) {
          const conflict: ConflictState = {
            attempted: {
              status: variables.status,
              resolutionNotes: variables.resolutionNotes ?? null,
              viewedVersion: variables.version,
              attemptedAt: new Date().toISOString(),
            },
            server,
            message: error.message,
            requestId: error.requestId,
          };
          openConflict(conflict);
        }
        return;
      }

      pushToast({
        variant: 'error',
        title: 'Não foi possível mudar o status',
        description: describeError(error),
        durationMs: 5000,
      });
    },

    onSuccess: (incident, variables) => {
      idempotencyKeys.current.delete(variables.scope);
      markUpdated(incident.id);
      pushToast({
        variant: 'success',
        title: `Status atualizado para ${STATUS_LABELS[incident.status]}`,
        description: incident.code,
      });
    },

    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: incidentQueryKeys.detail(variables.id) });
      void queryClient.invalidateQueries({ queryKey: incidentQueryKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: incidentQueryKeys.counters() });
    },
  });
}

export type ChangeStatusMutation = ReturnType<typeof useChangeIncidentStatus>;
