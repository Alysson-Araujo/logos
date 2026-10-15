import { useCallback, useEffect, type RefObject } from 'react';
import { create } from 'zustand';

/** Modo de densidade da lista (seção 9.1: confortável e compacto). */
export type Density = 'comfortable' | 'compact';

const DENSITY_STORAGE_KEY = 'logos-density';

function readStoredDensity(): Density {
  try {
    const raw = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    return raw === 'compact' ? 'compact' : 'comfortable';
  } catch {
    // localStorage indisponível (modo privado): segue com o padrão.
    return 'comfortable';
  }
}

function persistDensity(density: Density): void {
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // Falha ao persistir não deve interromper a experiência.
  }
}

interface UiStore {
  density: Density;
  /** Incrementado quando o atalho `/` pede foco na busca. */
  searchFocusToken: number;
  setDensity: (density: Density) => void;
  toggleDensity: () => void;
  requestSearchFocus: () => void;
}

export const useUiStore = create<UiStore>()((set) => ({
  density: readStoredDensity(),
  searchFocusToken: 0,
  setDensity: (density) => {
    persistDensity(density);
    set({ density });
  },
  toggleDensity: () => {
    set((state) => {
      const density: Density = state.density === 'compact' ? 'comfortable' : 'compact';
      persistDensity(density);
      return { density };
    });
  },
  requestSearchFocus: () => {
    set((state) => ({ searchFocusToken: state.searchFocusToken + 1 }));
  },
}));

/** Aplica a densidade no documento para que os tokens de espaçamento respondam. */
export function useDensity(): Density {
  const density = useUiStore((state) => state.density);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  return density;
}

/**
 * Foca o campo de busca sempre que o token muda (atalho `/`).
 * O token começa em 0: a primeira execução do efeito é ignorada.
 */
export function useSearchFocus(
  searchFocusToken: number,
  inputRef: RefObject<HTMLInputElement | null>,
): void {
  const focusSearch = useCallback((): void => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    input.select();
  }, [inputRef]);

  useEffect(() => {
    if (searchFocusToken === 0) return;
    focusSearch();
  }, [searchFocusToken, focusSearch]);
}
