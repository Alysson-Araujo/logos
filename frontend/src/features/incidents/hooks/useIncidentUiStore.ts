import { create } from 'zustand';

import type { ConflictState } from '../types';

/** Tempo que a linha recém-atualizada fica destacada (estado `success`). */
export const ROW_FLASH_MS = 1400;

interface IncidentUiStore {
  /** Ordem visível da lista: base para navegação por `j`/`k`. */
  orderedIds: string[];
  focusedId: string | null;
  /**
   * Incrementa **somente** na navegação por teclado (`j`/`k`) e é o gatilho
   * para a lista trazer a linha focada para a tela.
   *
   * O foco por mouse **não** incrementa: a linha sob o cursor já está visível,
   * e rolar nesse momento cancela a animação do wheel e empurra a lista quando
   * a linha está na borda (issue #114).
   */
  focusRevealToken: number;
  selectedId: string | null;
  /** Incidente que acabou de ser confirmado pelo servidor (linha pisca). */
  recentlyUpdatedId: string | null;
  /** Conflito de versão pendente de decisão do analista. */
  conflict: ConflictState | null;
  setOrderedIds: (ids: string[]) => void;
  setFocusedId: (id: string | null) => void;
  focusNext: () => void;
  focusPrevious: () => void;
  openFocused: () => void;
  openIncident: (id: string) => void;
  closeDrawer: () => void;
  markUpdated: (id: string) => void;
  clearUpdated: () => void;
  openConflict: (conflict: ConflictState) => void;
  closeConflict: () => void;
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;

export const useIncidentUiStore = create<IncidentUiStore>()((set) => ({
  orderedIds: [],
  focusedId: null,
  focusRevealToken: 0,
  selectedId: null,
  recentlyUpdatedId: null,
  conflict: null,

  setOrderedIds: (ids) => {
    set((state) => {
      const stillVisible = state.focusedId !== null && ids.includes(state.focusedId);
      return { orderedIds: ids, focusedId: stillVisible ? state.focusedId : null };
    });
  },

  setFocusedId: (id) => {
    set({ focusedId: id });
  },

  focusNext: () => {
    set((state) => {
      if (state.orderedIds.length === 0) return {};
      const currentIndex =
        state.focusedId === null ? -1 : state.orderedIds.indexOf(state.focusedId);
      const nextIndex = Math.min(currentIndex + 1, state.orderedIds.length - 1);
      return {
        focusedId: state.orderedIds[nextIndex] ?? null,
        focusRevealToken: state.focusRevealToken + 1,
      };
    });
  },

  focusPrevious: () => {
    set((state) => {
      if (state.orderedIds.length === 0) return {};
      const currentIndex = state.focusedId === null ? 0 : state.orderedIds.indexOf(state.focusedId);
      const previousIndex = Math.max(currentIndex - 1, 0);
      return {
        focusedId: state.orderedIds[previousIndex] ?? null,
        focusRevealToken: state.focusRevealToken + 1,
      };
    });
  },

  openFocused: () => {
    set((state) => (state.focusedId === null ? {} : { selectedId: state.focusedId }));
  },

  openIncident: (id) => {
    set({ selectedId: id, focusedId: id });
  },

  closeDrawer: () => {
    set({ selectedId: null });
  },

  markUpdated: (id) => {
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      set((state) => (state.recentlyUpdatedId === id ? { recentlyUpdatedId: null } : {}));
    }, ROW_FLASH_MS);
    set({ recentlyUpdatedId: id });
  },

  clearUpdated: () => {
    if (flashTimer !== null) clearTimeout(flashTimer);
    set({ recentlyUpdatedId: null });
  },

  openConflict: (conflict) => {
    set({ conflict });
  },

  closeConflict: () => {
    set({ conflict: null });
  },
}));
