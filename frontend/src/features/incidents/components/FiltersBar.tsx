import { Rows3, Rows4, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SEARCH_DEBOUNCE_MS, useDebounce } from '@/hooks/useDebounce';
import { useSearchFocus, useUiStore } from '@/hooks/useUiStore';
import { formatCount } from '@/lib/formatters';
import { cn, toggleInArray } from '@/lib/utils';

import type { HistoryMode } from '../hooks/useIncidentFilters';
import { CATEGORY_LABELS, CRITICALITY_LABELS, SORT_LABELS, STATUS_LABELS } from '../labels';
import {
  DEFAULT_INCIDENT_FILTERS,
  INCIDENT_CATEGORIES,
  INCIDENT_CRITICALITIES,
  INCIDENT_SORTS,
  INCIDENT_STATUSES,
  type IncidentCategory,
  type IncidentFilters,
  type IncidentSort,
  type IncidentStatus,
} from '../types';
import { CRITICALITY_PRESENTATION } from './CriticalityBadge';
import { STATUS_PRESENTATION } from './StatusBadge';

export interface FiltersBarProps {
  filters: IncidentFilters;
  activeFilterCount: number;
  total: number | null;
  isFetching: boolean;
  onPatch: (patch: Partial<IncidentFilters>, mode?: HistoryMode) => void;
  onClear: () => void;
}

function toSort(value: string): IncidentSort {
  return INCIDENT_SORTS.find((candidate) => candidate === value) ?? DEFAULT_INCIDENT_FILTERS.sort;
}

/** Barra de filtros com estado na URL: link compartilhável (seção 9.7). */
export function FiltersBar({
  filters,
  activeFilterCount,
  total,
  isFetching,
  onPatch,
  onClear,
}: FiltersBarProps) {
  const [searchText, setSearchText] = useState(filters.search);
  const debouncedSearch = useDebounce(searchText, SEARCH_DEBOUNCE_MS);
  const lastEmittedSearch = useRef(filters.search);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchFocusToken = useUiStore((state) => state.searchFocusToken);
  const density = useUiStore((state) => state.density);
  const toggleDensity = useUiStore((state) => state.toggleDensity);
  useSearchFocus(searchFocusToken, searchInputRef);

  useEffect(() => {
    if (debouncedSearch === lastEmittedSearch.current) return;
    lastEmittedSearch.current = debouncedSearch;
    onPatch({ search: debouncedSearch }, 'replace');
  }, [debouncedSearch, onPatch]);

  useEffect(() => {
    if (filters.search === lastEmittedSearch.current) return;
    lastEmittedSearch.current = filters.search;
    setSearchText(filters.search);
  }, [filters.search]);

  const hasCriticalities = filters.criticalities.length > 0;
  const hasSort = filters.sort !== DEFAULT_INCIDENT_FILTERS.sort;

  const chips: { key: string; label: string; onRemove: () => void }[] = [
    ...filters.criticalities.map((criticality) => ({
      key: `crit-${criticality}`,
      label: CRITICALITY_LABELS[criticality],
      onRemove: () => {
        onPatch({ criticalities: filters.criticalities.filter((item) => item !== criticality) });
      },
    })),
    ...filters.categories.map((category) => ({
      key: `cat-${category}`,
      label: CATEGORY_LABELS[category],
      onRemove: () => {
        onPatch({ categories: filters.categories.filter((item) => item !== category) });
      },
    })),
    ...filters.statuses.map((status) => ({
      key: `status-${status}`,
      label: STATUS_LABELS[status],
      onRemove: () => {
        onPatch({ statuses: filters.statuses.filter((item) => item !== status) });
      },
    })),
  ];

  return (
    <section
      aria-label="Filtros"
      data-tour="filters"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 shadow-e1"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[15rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden="true"
          />
          <Input
            ref={searchInputRef}
            id="incident-search"
            type="search"
            value={searchText}
            aria-label="Buscar incidentes por código, placa, local ou motorista"
            placeholder="Buscar por código, placa, local, motorista…  (/ )"
            className="pl-8"
            onChange={(event) => {
              setSearchText(event.target.value);
            }}
          />
        </div>

        <Select
          value={filters.sort}
          onValueChange={(value) => {
            onPatch({ sort: toSort(value) });
          }}
        >
          <SelectTrigger aria-label="Ordenar incidentes" className="w-[13.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INCIDENT_SORTS.map((sort) => (
              <SelectItem key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="secondary"
          size="sm"
          aria-pressed={density === 'compact'}
          onClick={toggleDensity}
          title="Alternar densidade da lista"
        >
          {density === 'compact' ? (
            <Rows4 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Rows3 className="h-4 w-4" aria-hidden="true" />
          )}
          {density === 'compact' ? 'Confortável' : 'Compacto'}
        </Button>

        {activeFilterCount > 0 || hasSort ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Limpar filtros
          </Button>
        ) : null}

        <span className="ml-auto font-mono text-2xs nums text-fg-muted" aria-live="polite">
          {total === null ? 'carregando…' : `${formatCount(total)} incidentes`}
          {isFetching ? ' · atualizando' : ''}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-fg-subtle">
          Criticidade
        </span>
        <button
          type="button"
          aria-pressed={!hasCriticalities}
          onClick={() => {
            onPatch({ criticalities: [] });
          }}
          className={cn(
            'rounded-full border px-2.5 py-1 text-2xs font-semibold transition-colors duration-hover',
            !hasCriticalities
              ? 'border-accent bg-accent text-accent-fg'
              : 'border-border text-fg-muted hover:bg-surface-sunken',
          )}
        >
          Todas
        </button>
        {INCIDENT_CRITICALITIES.map((criticality) => {
          const presentation = CRITICALITY_PRESENTATION[criticality];
          const isActive = filters.criticalities.includes(criticality);
          return (
            <button
              key={criticality}
              type="button"
              aria-pressed={isActive}
              onClick={() => {
                onPatch({ criticalities: toggleInArray(filters.criticalities, criticality) });
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-semibold transition-colors duration-hover',
                isActive
                  ? cn(presentation.softClass, presentation.textClass, 'border-transparent')
                  : 'border-border text-fg-muted hover:bg-surface-sunken',
              )}
            >
              <span aria-hidden="true">{presentation.icon}</span>
              {presentation.label}
            </button>
          );
        })}

        <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />

        <MultiSelectMenu
          label="Categoria"
          options={INCIDENT_CATEGORIES}
          selected={filters.categories}
          getOptionLabel={(category) => CATEGORY_LABELS[category]}
          onToggle={(category: IncidentCategory) => {
            onPatch({ categories: toggleInArray(filters.categories, category) });
          }}
        />
        <MultiSelectMenu
          label="Status"
          options={INCIDENT_STATUSES}
          selected={filters.statuses}
          getOptionLabel={(status) => STATUS_PRESENTATION[status].label}
          onToggle={(status: IncidentStatus) => {
            onPatch({ statuses: toggleInArray(filters.statuses, status) });
          }}
        />
      </div>

      {chips.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-2" aria-label="Filtros ativos">
          {chips.map((chip) => (
            <li key={chip.key}>
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-sunken py-0.5 pl-2 pr-1 text-2xs text-fg-muted">
                {chip.label}
                <button
                  type="button"
                  aria-label={`Remover filtro ${chip.label}`}
                  onClick={chip.onRemove}
                  className="rounded-full p-0.5 transition-colors duration-hover hover:bg-border hover:text-fg"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

interface MultiSelectMenuProps<TOption extends string> {
  label: string;
  options: readonly TOption[];
  selected: readonly TOption[];
  getOptionLabel: (option: TOption) => string;
  onToggle: (option: TOption) => void;
}

function MultiSelectMenu<TOption extends string>({
  label,
  options,
  selected,
  getOptionLabel,
  onToggle,
}: MultiSelectMenuProps<TOption>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={`Filtrar por ${label.toLowerCase()}`}>
          {label}
          {selected.length > 0 ? (
            <span className="rounded-full bg-accent px-1.5 text-2xs font-semibold text-accent-fg">
              {selected.length}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={selected.includes(option)}
            onSelect={(event) => {
              event.preventDefault();
              onToggle(option);
            }}
          >
            {getOptionLabel(option)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
