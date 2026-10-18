import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef } from 'react';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { RefetchBar } from '@/components/feedback/RefetchBar';
import { SkeletonList } from '@/components/feedback/SkeletonList';
import { Button } from '@/components/ui/button';
import type { Density } from '@/hooks/useUiStore';
import { formatCount } from '@/lib/formatters';
import { isContractError } from '@/lib/http';
import { cn } from '@/lib/utils';

import { countActiveFilters } from '../hooks/useIncidentFilters';
import { describeActiveFilters } from '../labels';
import type { Incident, IncidentFilters } from '../types';
import { IncidentRow } from './IncidentRow';

const ROW_HEIGHT_COMFORTABLE = 86;
const ROW_HEIGHT_COMPACT = 66;
/** 6 de overscan acima + 6 abaixo mantêm ~20 nós no DOM mesmo com 120 itens. */
const OVERSCAN = 6;
const PREFETCH_THRESHOLD = 4;

export interface IncidentListProps {
  items: Incident[];
  filters: IncidentFilters;
  total: number | null;
  density: Density;
  focusedId: string | null;
  /** Avança só na navegação por teclado; é o gatilho de rolagem da lista. */
  focusRevealToken: number;
  selectedId: string | null;
  isInitialLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: unknown;
  failureCount: number;
  isRetrying: boolean;
  pendingIds: ReadonlySet<string>;
  recentlyUpdatedId: string | null;
  onLoadMore: () => void;
  onRetry: () => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onFocus: (id: string) => void;
  onClearFilters: () => void;
}

/**
 * Lista virtualizada (`@tanstack/react-virtual`): 120 itens, ~20 nós no DOM.
 * Concentra também os estados `initialLoading`, `refetching`, `loadingMore`,
 * `emptyInitial`, `emptyFiltered` e `errorRecoverable` (cache antigo visível).
 */
export function IncidentList({
  items,
  filters,
  total,
  density,
  focusedId,
  focusRevealToken,
  selectedId,
  isInitialLoading,
  isFetching,
  isFetchingNextPage,
  hasNextPage,
  error,
  failureCount,
  isRetrying,
  pendingIds,
  recentlyUpdatedId,
  onLoadMore,
  onRetry,
  onCreate,
  onOpen,
  onFocus,
  onClearFilters,
}: IncidentListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (density === 'compact' ? ROW_HEIGHT_COMPACT : ROW_HEIGHT_COMFORTABLE),
    overscan: OVERSCAN,
    getItemKey: (index) => items[index]?.id ?? index,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [density, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex =
    virtualItems.length > 0 ? (virtualItems[virtualItems.length - 1]?.index ?? -1) : -1;

  // Scroll infinito com cursor: busca a próxima página perto do fim da lista.
  useEffect(() => {
    if (lastVisibleIndex < 0 || !hasNextPage || isFetchingNextPage) return;
    if (lastVisibleIndex >= items.length - PREFETCH_THRESHOLD) onLoadMore();
  }, [lastVisibleIndex, items.length, hasNextPage, isFetchingNextPage, onLoadMore]);

  const focusedIndex = useMemo(
    () => (focusedId === null ? -1 : items.findIndex((item) => item.id === focusedId)),
    [focusedId, items],
  );

  // Mantém a linha focada visível — **apenas** na navegação por teclado.
  //
  // O token só avança em `j`/`k`; o hover e o clique mudam `focusedId` sem
  // mexer nele. Rolar no hover empurrava a lista quando a linha estava na
  // borda e cancelava a animação do wheel durante a rolagem (issue #114).
  const lastRevealToken = useRef(0);
  useEffect(() => {
    if (focusRevealToken === lastRevealToken.current) return;
    lastRevealToken.current = focusRevealToken;
    if (focusedIndex < 0) return;
    virtualizer.scrollToIndex(focusedIndex, { align: 'auto' });
  }, [focusRevealToken, focusedIndex, virtualizer]);

  const isFiltered = countActiveFilters(filters) > 0;

  if (isInitialLoading) {
    return (
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <SkeletonList rows={8} />
      </div>
    );
  }

  if (error !== null && items.length === 0) {
    return (
      <ErrorState
        variant={isContractError(error) ? 'fatal' : 'recoverable'}
        error={error}
        onRetry={onRetry}
        isRetrying={isRetrying}
        failureCount={failureCount}
      />
    );
  }

  if (items.length === 0) {
    return (
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        {isFiltered ? (
          <EmptyState
            variant="filtered"
            filterDescriptions={describeActiveFilters(filters)}
            onClearFilters={onClearFilters}
          />
        ) : (
          <EmptyState variant="initial" onCreate={onCreate} />
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-2" aria-label="Incidentes" data-tour="list">
      {/* errorRecoverable: o cache antigo continua na tela, com aviso acima. */}
      {error === null ? null : (
        <ErrorState
          variant={isContractError(error) ? 'fatal' : 'recoverable'}
          error={error}
          onRetry={onRetry}
          isRetrying={isRetrying}
          failureCount={failureCount}
          compact
        />
      )}

      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <RefetchBar isFetching={isFetching} isInitialLoading={isInitialLoading} />
        <div
          id="lista-de-incidentes"
          ref={scrollRef}
          role="list"
          aria-label="Lista de incidentes ordenada por prioridade"
          tabIndex={-1}
          className="h-[70vh] min-h-[360px] overflow-auto overscroll-contain md:h-[calc(100vh-27rem)] md:min-h-[420px]"
        >
          <div
            style={{
              height: `${String(virtualizer.getTotalSize())}px`,
              position: 'relative',
              width: '100%',
            }}
          >
            {virtualItems.map((virtualItem) => {
              const incident = items[virtualItem.index];
              if (incident === undefined) return null;
              return (
                <div
                  key={virtualItem.key}
                  role="listitem"
                  // `data-index` + `measureElement`: a altura real da linha
                  // manda. A estimativa de 86 px ficava 7 px abaixo da altura
                  // medida (93 px), o que encolhia a área rolável, sobrepunha
                  // as linhas e fazia a lista pular quando a página seguinte
                  // entrava (#114).
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${String(virtualItem.start)}px)`,
                  }}
                >
                  <IncidentRow
                    incident={incident}
                    density={density}
                    isFocused={incident.id === focusedId}
                    isSelected={incident.id === selectedId}
                    isPending={pendingIds.has(incident.id)}
                    isRecentlyUpdated={incident.id === recentlyUpdatedId}
                    onOpen={onOpen}
                    onFocus={onFocus}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* loadingMore: skeleton de 3 linhas no fim da lista. */}
        {isFetchingNextPage ? <SkeletonList rows={3} /> : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <p className="text-2xs text-fg-subtle" aria-live="polite">
            {formatCount(items.length)} de {total === null ? '—' : formatCount(total)} incidentes
            carregados
          </p>
          {hasNextPage ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onLoadMore}
              disabled={isFetchingNextPage}
              className={cn(isFetchingNextPage ? 'opacity-70' : null)}
            >
              {isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
            </Button>
          ) : (
            <span className="text-2xs text-fg-subtle">fim da lista</span>
          )}
        </div>
      </div>
    </section>
  );
}
