import { useEffect, useState } from 'react';

/**
 * Estado de tela na URL, sem roteador.
 *
 * O app não tem router: a triagem já guarda os filtros na query string e a
 * navegação entre telas usa o mesmo mecanismo (`?view=contas`). Assim o link é
 * compartilhável, o botão voltar do navegador funciona e não entra uma
 * dependência nova só para duas telas.
 */

export type HistoryMode = 'push' | 'replace';

/** Evento próprio: `pushState` não dispara nada que o React escute. */
export const LOCATION_CHANGE_EVENT = 'logos:locationchange';

export function readLocationSearch(): string {
  return window.location.search;
}

export function notifyLocationChange(): void {
  window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
}

export function writeLocationSearch(search: string, mode: HistoryMode): void {
  const url = `${window.location.pathname}${search}${window.location.hash}`;
  if (mode === 'push') {
    window.history.pushState(null, '', url);
  } else {
    window.history.replaceState(null, '', url);
  }
  notifyLocationChange();
}

/** `'?a=1'` a partir dos parâmetros; string vazia quando não sobra nada. */
export function toSearchString(params: URLSearchParams): string {
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export function readSearchParams(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
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
