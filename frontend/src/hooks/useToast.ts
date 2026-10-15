import { create } from 'zustand';

import { createClientId } from '@/lib/utils';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  description: string | null;
  variant: ToastVariant;
  durationMs: number;
}

export interface ToastInput {
  title: string;
  description?: string | null;
  variant?: ToastVariant;
  durationMs?: number;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (input: ToastInput) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** Sucesso fica 2,5 s na tela (seção 8.2). */
export const TOAST_DURATION_MS = 2500;
const MAX_VISIBLE_TOASTS = 4;

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],
  push: (input) => {
    const toast: ToastItem = {
      id: createClientId('toast'),
      title: input.title,
      description: input.description ?? null,
      variant: input.variant ?? 'info',
      durationMs: input.durationMs ?? TOAST_DURATION_MS,
    };
    set((state) => ({ toasts: [...state.toasts, toast].slice(-MAX_VISIBLE_TOASTS) }));
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
  clear: () => {
    set({ toasts: [] });
  },
}));

/** Atalho de leitura: componentes só precisam publicar toasts. */
export function useToast(): (input: ToastInput) => void {
  return useToastStore((state) => state.push);
}
