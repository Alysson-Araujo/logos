import { keepPreviousData, useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';

import { ApiError } from '@/lib/http';
import { STALE_TIME_MS } from '@/lib/queryClient';

import { fetchIncidentById, fetchIncidentCountByStatus, fetchIncidentList } from '../api/endpoints';
import {
  INCIDENT_STATUSES,
  type IncidentFilters,
  type IncidentListResponse,
  type IncidentStatus,
} from '../types';

/** Chaves de cache: uma entrada por combinação de filtros (volta instantânea). */
export const incidentQueryKeys = {
  all: ['incidents'] as const,
  lists: () => [...incidentQueryKeys.all, 'list'] as const,
  list: (filters: IncidentFilters) =>
    [...incidentQueryKeys.lists(), normalizeFilterKey(filters)] as const,
  detail: (id: string) => [...incidentQueryKeys.all, 'detail', id] as const,
  events: (id: string) => [...incidentQueryKeys.all, 'events', id] as const,
  counters: () => [...incidentQueryKeys.all, 'counters'] as const,
  counter: (status: IncidentStatus) => [...incidentQueryKeys.counters(), status] as const,
};

/** Serialização estável: mesma seleção → mesma chave (ordem não importa). */
export function normalizeFilterKey(filters: IncidentFilters): string {
  return JSON.stringify({
    statuses: [...filters.statuses].sort(),
    criticalities: [...filters.criticalities].sort(),
    categories: [...filters.categories].sort(),
    search: filters.search.trim().toLowerCase(),
    sort: filters.sort,
  });
}

export function useIncidentList(filters: IncidentFilters) {
  return useInfiniteQuery({
    queryKey: incidentQueryKeys.list(filters),
    queryFn: ({ pageParam, signal }) => fetchIncidentList({ filters, cursor: pageParam, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: IncidentListResponse) =>
      lastPage.pageInfo.hasNextPage ? lastPage.pageInfo.nextCursor : null,
    placeholderData: keepPreviousData,
    staleTime: STALE_TIME_MS,
  });
}

export interface IncidentCounters {
  byStatus: Record<IncidentStatus, number>;
  total: number;
  isLoading: boolean;
  isError: boolean;
}

/** KPI do topo: 4 leituras de `limit=1` (só o `meta.total` interessa). */
export function useIncidentCounters(): IncidentCounters {
  const results = useQueries({
    queries: INCIDENT_STATUSES.map((status) => ({
      queryKey: incidentQueryKeys.counter(status),
      queryFn: (context: { signal: AbortSignal }) =>
        fetchIncidentCountByStatus(status, context.signal),
      staleTime: STALE_TIME_MS,
    })),
  });

  const byStatus: Record<IncidentStatus, number> = {
    ABERTO: 0,
    EM_INVESTIGACAO: 0,
    FECHADO: 0,
    INCONCLUSIVO: 0,
  };

  INCIDENT_STATUSES.forEach((status, index) => {
    byStatus[status] = results[index]?.data ?? 0;
  });

  return {
    byStatus,
    total: INCIDENT_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
    isLoading: results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
  };
}

export function useIncidentDetail(id: string | null) {
  return useQuery({
    queryKey: incidentQueryKeys.detail(id ?? 'sem-selecao'),
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      if (id === null) {
        throw new ApiError({
          status: 0,
          code: 'MISSING_INCIDENT_ID',
          message: 'Nenhum incidente selecionado.',
          kind: 'contract',
        });
      }
      return fetchIncidentById(id, signal);
    },
    enabled: id !== null,
    staleTime: STALE_TIME_MS,
  });
}
