import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';

/** Preferência do analista; `system` acompanha o sistema operacional. */
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'logos-theme';

function readStoredTheme(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
  } catch {
    // Sem localStorage (modo privado): cai na preferência do sistema.
    return 'system';
  }
}

function persistTheme(theme: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Persistência é conveniência: falhar aqui não deve quebrar o tema.
  }
}

interface ThemeStore {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

export const useThemeStore = create<ThemeStore>()((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    persistTheme(theme);
    set({ theme });
  },
}));

function prefersDarkScheme(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export interface UseThemeResult {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  toggleTheme: () => void;
}

/**
 * Tema claro/escuro persistido, respeitando `prefers-color-scheme`
 * enquanto a preferência for `system`.
 */
export function useTheme(): UseThemeResult {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [systemPrefersDark, setSystemPrefersDark] = useState(prefersDarkScheme);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent): void => {
      setSystemPrefersDark(event.matches);
    };
    query.addEventListener('change', handleChange);
    return () => {
      query.removeEventListener('change', handleChange);
    };
  }, []);

  const resolvedTheme: ResolvedTheme =
    theme === 'dark' || (theme === 'system' && systemPrefersDark) ? 'dark' : 'light';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const toggleTheme = useCallback((): void => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
