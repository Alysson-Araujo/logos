import { useCallback, useEffect, useMemo, useState } from 'react';

import { toggleInArray } from '@/lib/utils';

import {
  DEFAULT_INCIDENT_FILTERS,
  INCIDENT_CATEGORIES,
  INCIDENT_CRITICALITIES,
  INCIDENT_SORTS,
  INCIDENT_STATUSES,
  type IncidentCategory,
  type IncidentCriticality,
  type IncidentFilters,
  type IncidentSort,
  type IncidentStatus,
} from '../types';

export type HistoryMode = 'push' | 'replace';

export const FILTER_CSV_SEPARATOR = ',';
const LOCATION_CHANGE_EVENT = 'logos:locationchange';

/* ------------------------------------------------------------------ */
/* Serialização (funções puras — cobertas por teste)                   */
/* ------------------------------------------------------------------ */

function parseCsv<TValue extends string>(raw: string | null, allowed: readonly TValue[]): TValue[] {
  if (raw === null || raw === '') return [];
  const seen = new Set<TValue>();
  for (const chunk of raw.split(FILTER_CSV_SEPARATOR)) {
    const value = chunk.trim().toUpperCase();
    const match = allowed.find((candidate) => candidate === value);
    if (match !== undefined) seen.add(match);
  }
  return [...seen];
}

export function parseIncidentFilters(search: string): IncidentFilters {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const sort = params.get('sort');
  return {
    statuses: parseCsv(params.get('status'), INCIDENT_STATUSES),
    criticalities: parseCsv(params.get('criticality'), INCIDENT_CRITICALITIES),
    categories: parseCsv(params.get('category'), INCIDENT_CATEGORIES),
    search: params.get('search') ?? '',
    sort: INCIDENT_SORTS.find((candidate) => candidate === sort) ?? DEFAULT_INCIDENT_FILTERS.sort,
  };
}

/** Gera a query string; a ordenação padrão é omitida para manter a URL curta. */
export function buildIncidentSearch(filters: IncidentFilters): string {
  const params = new URLSearchParams();
  if (filters.statuses.length > 0)
    params.set('status', filters.statuses.join(FILTER_CSV_SEPARATOR));
  if (filters.criticalities.length > 0) {
    params.set('criticality', filters.criticalities.join(FILTER_CSV_SEPARATOR));
  }
  if (filters.categories.length > 0) {
    params.set('category', filters.categories.join(FILTER_CSV_SEPARATOR));
  }
  const search = filters.search.trim();
  if (search !== '') params.set('search', search);
  if (filters.sort !== DEFAULT_INCIDENT_FILTERS.sort) params.set('sort', filters.sort);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export function countActiveFilters(filters: IncidentFilters): number {
  let count = filters.statuses.length + filters.criticalities.length + filters.categories.length;
  if (filters.search.trim() !== '') count += 1;
  return count;
}

export function hasActiveFilters(filters: IncidentFilters): boolean {
  return countActiveFilters(filters) > 0;
}

export function isSortActive(filters: IncidentFilters): boolean {
  return filters.sort !== DEFAULT_INCIDENT_FILTERS.sort;
}

/* ------------------------------------------------------------------ */
/* Estado na URL                                                       */
/* ------------------------------------------------------------------ */

function readLocationSearch(): string {
  return window.location.search;
}

function notifyLocationChange(): void {
  window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
}

function writeLocationSearch(search: string, mode: HistoryMode): void {
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  if (mode === 'push') {
    window.history.pushState(null, '', url);
  } else {
    window.history.replaceState(null, '', url);
  }
  notifyLocationChange();
}

/** Observa a query string (inclusive o botão voltar do navegador). */
export function useLocationSearch(): string {
  const [search, setSearch] = useState<string>(() => readLocationSearch());

  useEffect(() => {
    const syncSearch = (): void => {
      setSearch(readLocationSearch());
    };
    window.addEventListener('popstate', syncSearch);
    window.addEventListener(LOCATION_CHANGE_EVENT, syncSearch);
    return () => {
      window.removeEventListener('popstate', syncSearch);
      window.removeEventListener(LOCATION_CHANGE_EVENT, syncSearch);
    };
  }, []);

  return search;
}

export interface UseIncidentFiltersResult {
  filters: IncidentFilters;
  setFilters: (next: IncidentFilters, mode?: HistoryMode) => void;
  patchFilters: (patch: Partial<IncidentFilters>, mode?: HistoryMode) => void;
  toggleStatus: (status: IncidentStatus) => void;
  toggleCriticality: (criticality: IncidentCriticality) => void;
  toggleCategory: (category: IncidentCategory) => void;
  setSearch: (search: string) => void;
  setSort: (sort: IncidentSort) => void;
  clearFilters: () => void;
  activeFilterCount: number;
}

/**
 * Fonte única dos filtros: a URL. Assim o link é compartilhável com o colega
 * e o botão voltar do navegador desfaz a última seleção.
 */
export function useIncidentFilters(): UseIncidentFiltersResult {
  const search = useLocationSearch();
  const filters = useMemo(() => parseIncidentFilters(search), [search]);

  const setFilters = useCallback((next: IncidentFilters, mode: HistoryMode = 'replace'): void => {
    const nextSearch = buildIncidentSearch(next);
    if (nextSearch === readLocationSearch()) return;
    writeLocationSearch(nextSearch, mode);
  }, []);

  const patchFilters = useCallback(
    (patch: Partial<IncidentFilters>, mode: HistoryMode = 'push'): void => {
      setFilters({ ...parseIncidentFilters(readLocationSearch()), ...patch }, mode);
    },
    [setFilters],
  );

  const toggleStatus = useCallback(
    (status: IncidentStatus): void => {
      patchFilters({
        statuses: toggleInArray(parseIncidentFilters(readLocationSearch()).statuses, status),
      });
    },
    [patchFilters],
  );

  const toggleCriticality = useCallback(
    (criticality: IncidentCriticality): void => {
      patchFilters({
        criticalities: toggleInArray(
          parseIncidentFilters(readLocationSearch()).criticalities,
          criticality,
        ),
      });
    },
    [patchFilters],
  );

  const toggleCategory = useCallback(
    (category: IncidentCategory): void => {
      patchFilters({
        categories: toggleInArray(parseIncidentFilters(readLocationSearch()).categories, category),
      });
    },
    [patchFilters],
  );

  const setSearch = useCallback(
    (value: string): void => {
      patchFilters({ search: value }, 'replace');
    },
    [patchFilters],
  );

  const setSort = useCallback(
    (sort: IncidentSort): void => {
      patchFilters({ sort });
    },
    [patchFilters],
  );

  const clearFilters = useCallback((): void => {
    setFilters(DEFAULT_INCIDENT_FILTERS, 'push');
  }, [setFilters]);

  return {
    filters,
    setFilters,
    patchFilters,
    toggleStatus,
    toggleCriticality,
    toggleCategory,
    setSearch,
    setSort,
    clearFilters,
    activeFilterCount: countActiveFilters(filters),
  };
}
