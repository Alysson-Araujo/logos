import { Moon, Sun } from 'lucide-react';

import { useTheme } from '@/hooks/useTheme';

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      aria-pressed={isDark}
      title={isDark ? 'Tema claro (t)' : 'Tema escuro (t)'}
      className="inline-flex h-9 w-9 items-center justify-center rounded-sm border border-border bg-surface text-fg-muted transition-colors duration-hover ease-panel hover:bg-surface-sunken hover:text-fg"
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
