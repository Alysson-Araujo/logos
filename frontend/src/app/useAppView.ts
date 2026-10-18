import { useCallback, useMemo } from 'react';

import {
  readLocationSearch,
  readSearchParams,
  toSearchString,
  useLocationSearch,
  writeLocationSearch,
  type HistoryMode,
} from '@/lib/location';

/**
 * Qual tela está montada — decidido pela URL, como os filtros da triagem.
 *
 * `?view=contas` abre a administração de contas; qualquer outro valor (ou
 * nenhum) mantém a triagem. Os demais parâmetros da URL são preservados: ao
 * voltar para a fila, os filtros continuam como estavam.
 */

export const APP_VIEW_PARAM = 'view';
export const ACCOUNTS_VIEW = 'contas';

export type AppView = 'triagem' | 'contas';

export function parseAppView(search: string): AppView {
  return readSearchParams(search).get(APP_VIEW_PARAM) === ACCOUNTS_VIEW ? 'contas' : 'triagem';
}

export function withAppView(search: string, view: AppView): string {
  const params = readSearchParams(search);
  if (view === 'contas') {
    params.set(APP_VIEW_PARAM, ACCOUNTS_VIEW);
  } else {
    params.delete(APP_VIEW_PARAM);
  }
  return toSearchString(params);
}

export interface UseAppViewResult {
  view: AppView;
  /** Deep link para a administração de contas (`?view=contas`). */
  openAccounts: () => void;
  /** Volta para a triagem preservando os filtros da URL. */
  closeAccounts: () => void;
}

export function useAppView(): UseAppViewResult {
  const search = useLocationSearch();
  const view = useMemo(() => parseAppView(search), [search]);

  const setView = useCallback((next: AppView, mode: HistoryMode = 'push'): void => {
    const nextSearch = withAppView(readLocationSearch(), next);
    if (nextSearch === readLocationSearch()) return;
    writeLocationSearch(nextSearch, mode);
  }, []);

  const openAccounts = useCallback((): void => {
    setView('contas');
  }, [setView]);

  const closeAccounts = useCallback((): void => {
    setView('triagem', 'replace');
  }, [setView]);

  return { view, openAccounts, closeAccounts };
}
