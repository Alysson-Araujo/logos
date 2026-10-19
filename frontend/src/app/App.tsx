import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';

import { OfflineBanner } from '@/components/feedback/OfflineBanner';
import { AppShell } from '@/components/layout/AppShell';
import { useFilaDeMutacoes } from '@/hooks/useFilaDeMutacoes';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTheme } from '@/hooks/useTheme';
import { useDensity, useUiStore } from '@/hooks/useUiStore';

import { ConflictDialog } from '../features/incidents/components/ConflictDialog';
import { CreateIncidentSheet } from '../features/incidents/components/CreateIncidentSheet';
import { FiltersBar } from '../features/incidents/components/FiltersBar';
import { IncidentDrawer } from '../features/incidents/components/IncidentDrawer';
import { IncidentList } from '../features/incidents/components/IncidentList';
import { KpiCards } from '../features/incidents/components/KpiCards';
import { useIncidentFilters } from '../features/incidents/hooks/useIncidentFilters';
import { useChangeIncidentStatus } from '../features/incidents/hooks/useIncidentMutations';
import { useIncidentUiStore } from '../features/incidents/hooks/useIncidentUiStore';
import { useIncidentCounters, useIncidentList } from '../features/incidents/hooks/useIncidents';
import { WelcomeTour } from '../features/tour/WelcomeTour';
import { TOUR_STEPS } from '../features/tour/steps';
import { useTourStore } from '../features/tour/useTour';

const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();

/**
 * Tela de triagem: KPIs + filtros na URL + lista virtualizada + drawer de
 * ciclo de vida. Todo o estado de servidor vem do TanStack Query.
 */
export function App() {
  const { toggleTheme } = useTheme();
  const density = useDensity();
  const isOnline = useOnlineStatus();
  // Quantas alterações estão paradas esperando conexão — o banner mostra o
  // número para que ninguém repita uma transição por não saber se ela entrou.
  const filaDeMutacoes = useFilaDeMutacoes();
  const [isCreating, setIsCreating] = useState(false);

  const { filters, patchFilters, clearFilters, toggleStatus, activeFilterCount } =
    useIncidentFilters();
  const listQuery = useIncidentList(filters);
  const counters = useIncidentCounters();
  const statusMutation = useChangeIncidentStatus();

  const focusedId = useIncidentUiStore((state) => state.focusedId);
  const focusRevealToken = useIncidentUiStore((state) => state.focusRevealToken);
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
  const isTourOpen = useTourStore((state) => state.isOpen);
  /**
   * O guia está no passo que **abre** a janela de cadastro.
   *
   * Nesse passo a janela vira não-modal (ver `CreateIncidentSheet`): o cartão do
   * guia precisa continuar clicável por cima dela.
   */
  const isTourCreateStep = useTourStore(
    (state) => state.isOpen && TOUR_STEPS[state.stepIndex]?.target === 'create',
  );

  const items = useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [listQuery.data],
  );

  // Publica a ordem visível: base da navegação por `j`/`k`.
  useEffect(() => {
    setOrderedIds(items.map((item) => item.id));
  }, [items, setOrderedIds]);

  // Duas razões para desligar os atalhos: com a sheet de cadastro aberta quem
  // está digitando o formulário não deve navegar na lista por baixo do painel;
  // com o guia aberto `j`/`k`/`/` e `Esc` pertencem ao cartão, não à triagem que
  // está atrás do fundo escuro.
  useKeyboardShortcuts(
    {
      onNext: focusNext,
      onPrevious: focusPrevious,
      onOpen: openFocused,
      onFocusSearch: requestSearchFocus,
      onEscape: closeDrawer,
      onToggleTheme: toggleTheme,
    },
    !isTourOpen && !isCreating,
  );

  const pendingIds = useMemo<ReadonlySet<string>>(() => {
    if (!statusMutation.isPending) return EMPTY_ID_SET;
    return new Set([statusMutation.variables.id]);
  }, [statusMutation.isPending, statusMutation.variables]);

  const isRetrying = listQuery.isFetching && listQuery.isError;

  /**
   * Foco por mouse é atualização **não urgente**.
   *
   * Durante a rolagem as linhas passam sob o cursor e disparam `mouseenter` a
   * cada passo; marcar a linha em foco é trabalho que pode esperar o próximo
   * frame sem competir com a rolagem. O realce visual imediato fica por conta
   * do CSS (`hover:bg-surface-sunken`), que não depende deste estado.
   */
  const handleRowFocus = useCallback(
    (id: string): void => {
      startTransition(() => {
        setFocusedId(id);
      });
    },
    [setFocusedId],
  );

  const handleLoadMore = (): void => {
    if (!listQuery.hasNextPage || listQuery.isFetchingNextPage) return;
    void listQuery.fetchNextPage();
  };

  const handleRetry = (): void => {
    void listQuery.refetch();
  };

  /**
   * Abre a janela de cadastro. É o handler do botão "Novo incidente" **e** do
   * passo 4 do guia: um só caminho, nenhuma lógica duplicada.
   */
  const handleCreate = useCallback((): void => {
    setIsCreating(true);
  }, []);

  const handleCloseCreate = useCallback((): void => {
    setIsCreating(false);
    // Fechar a janela no passo do cadastro não pode deixar o guia preso nele:
    // o passo 4 é o que abre a janela, então fechá-la avança o passeio. Quando
    // quem fecha é o próprio guia (ao trocar de passo), o índice já mudou e a
    // condição abaixo é falsa — sem laço.
    const tour = useTourStore.getState();
    if (tour.isOpen && TOUR_STEPS[tour.stepIndex]?.target === 'create') tour.next();
  }, []);

  const total = listQuery.data?.pages[0]?.meta.total ?? null;
  // O guia só pode abrir sozinho depois que KPIs e lista saíram do carregamento.
  const isTriageReady = !counters.isLoading && !listQuery.isPending;

  return (
    <AppShell>
      <OfflineBanner isOnline={isOnline} pendingCount={filaDeMutacoes} />
      <KpiCards
        counters={counters}
        activeStatuses={filters.statuses}
        onToggleStatus={toggleStatus}
        isLoading={counters.isLoading}
        onCreate={handleCreate}
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
        focusRevealToken={focusRevealToken}
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
        onFocus={handleRowFocus}
        onClearFilters={clearFilters}
      />
      <IncidentDrawer incidentId={selectedId} mutation={statusMutation} onClose={closeDrawer} />
      <CreateIncidentSheet
        open={isCreating}
        onClose={handleCloseCreate}
        // No passo 4 do guia a janela abre junto com o cartão explicativo: ela
        // não pode ser modal, senão trava o foco e mata os botões do cartão.
        modal={!isTourCreateStep}
      />
      <ConflictDialog />
      <WelcomeTour
        ready={isTriageReady}
        onOpenCreate={handleCreate}
        onCloseCreate={handleCloseCreate}
      />
    </AppShell>
  );
}
