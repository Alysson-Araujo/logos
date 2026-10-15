import { useEffect, useMemo } from 'react';

import { OfflineBanner } from '@/components/feedback/OfflineBanner';
import { AppShell } from '@/components/layout/AppShell';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTheme } from '@/hooks/useTheme';
import { useToast } from '@/hooks/useToast';
import { useDensity, useUiStore } from '@/hooks/useUiStore';

import { ConflictDialog } from '../features/incidents/components/ConflictDialog';
import { FiltersBar } from '../features/incidents/components/FiltersBar';
import { IncidentDrawer } from '../features/incidents/components/IncidentDrawer';
import { IncidentList } from '../features/incidents/components/IncidentList';
import { KpiCards } from '../features/incidents/components/KpiCards';
import { useIncidentFilters } from '../features/incidents/hooks/useIncidentFilters';
import { useChangeIncidentStatus } from '../features/incidents/hooks/useIncidentMutations';
import { useIncidentUiStore } from '../features/incidents/hooks/useIncidentUiStore';
import { useIncidentCounters, useIncidentList } from '../features/incidents/hooks/useIncidents';

const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

/**
 * Tela de triagem: KPIs + filtros na URL + lista virtualizada + drawer de
 * ciclo de vida. Todo o estado de servidor vem do TanStack Query.
 */
export function App() {
  const { toggleTheme } = useTheme();
  const density = useDensity();
  const isOnline = useOnlineStatus();
  const pushToast = useToast();

  const { filters, patchFilters, clearFilters, toggleStatus, activeFilterCount } =
    useIncidentFilters();
  const listQuery = useIncidentList(filters);
  const counters = useIncidentCounters();
  const statusMutation = useChangeIncidentStatus();

  const focusedId = useIncidentUiStore((state) => state.focusedId);
  const selectedId = useIncidentUiStore((state) => state.selectedId);
  const recentlyUpdatedId = useIncidentUiStore((state) => state.recentlyUpdatedId);
  const setOrderedIds = useIncidentUiStore((state) => state.setOrderedIds);
  const setFocusedId = useIncidentUiStore((state) => state.setFocusedId);
  const focusNext = useIncidentUiStore((state) => state.focusNext);
  const focusPrevious = useIncidentUiStore((state) => state.focusPrevious);
  const openFocused = useIncidentUiStore((state) => state.openFocused);
  const openIncident = useIncidentUiStore((state) => state.openIncident);
  const closeDrawer = useIncidentUiStore((state) => state.closeDrawer);
  const requestSearchFocus = useUiStore((state) => state.requestSearchFocus);

  const items = useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [listQuery.data],
  );

  // Publica a ordem visível: base da navegação por `j`/`k`.
  useEffect(() => {
    setOrderedIds(items.map((item) => item.id));
  }, [items, setOrderedIds]);

  useKeyboardShortcuts({
    onNext: focusNext,
    onPrevious: focusPrevious,
    onOpen: openFocused,
    onFocusSearch: requestSearchFocus,
    onEscape: closeDrawer,
    onToggleTheme: toggleTheme,
  });

  const pendingIds = useMemo<ReadonlySet<string>>(() => {
    if (!statusMutation.isPending) return EMPTY_ID_SET;
    return new Set([statusMutation.variables.id]);
  }, [statusMutation.isPending, statusMutation.variables]);

  const isRetrying = listQuery.isFetching && listQuery.isError;

  const handleLoadMore = (): void => {
    if (!listQuery.hasNextPage || listQuery.isFetchingNextPage) return;
    void listQuery.fetchNextPage();
  };

  const handleRetry = (): void => {
    void listQuery.refetch();
  };

  const handleCreate = (): void => {
    pushToast({
      variant: 'info',
      title: 'Criação de incidente já está no backlog',
      description: 'O formulário validado com Zod entra na issue #55.',
    });
  };

  const total = listQuery.data?.pages[0]?.meta.total ?? null;

  return (
    <AppShell>
      <OfflineBanner isOnline={isOnline} />
      <KpiCards
        counters={counters}
        activeStatuses={filters.statuses}
        onToggleStatus={toggleStatus}
        isLoading={counters.isLoading}
      />
      <FiltersBar
        filters={filters}
        activeFilterCount={activeFilterCount}
        total={total}
        isFetching={listQuery.isFetching}
        onPatch={patchFilters}
        onClear={clearFilters}
      />
      <IncidentList
        items={items}
        filters={filters}
        total={total}
        density={density}
        focusedId={focusedId}
        selectedId={selectedId}
        isInitialLoading={listQuery.isPending}
        isFetching={listQuery.isFetching}
        isFetchingNextPage={listQuery.isFetchingNextPage}
        hasNextPage={listQuery.hasNextPage}
        error={listQuery.error}
        failureCount={listQuery.failureCount}
        isRetrying={isRetrying}
        pendingIds={pendingIds}
        recentlyUpdatedId={recentlyUpdatedId}
        onLoadMore={handleLoadMore}
        onRetry={handleRetry}
        onCreate={handleCreate}
        onOpen={openIncident}
        onFocus={setFocusedId}
        onClearFilters={clearFilters}
      />
      <IncidentDrawer incidentId={selectedId} mutation={statusMutation} onClose={closeDrawer} />
      <ConflictDialog />
    </AppShell>
  );
}
