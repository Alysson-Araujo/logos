import { useEffect, useRef } from 'react';

export interface KeyboardShortcutHandlers {
  /** `j` — próximo incidente. */
  onNext?: () => void;
  /** `k` — incidente anterior. */
  onPrevious?: () => void;
  /** `Enter` — abre o incidente focado. */
  onOpen?: () => void;
  /** `/` — foca a busca. */
  onFocusSearch?: () => void;
  /** `Esc` — fecha o drawer. */
  onEscape?: () => void;
  /** `t` — alterna o tema. */
  onToggleTheme?: () => void;
}

const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return TEXT_INPUT_TAGS.has(target.tagName);
}

/**
 * Atalhos no estilo Gmail: `j`/`k` navegam, `Enter` abre, `/` busca, `Esc` fecha.
 * Os handlers são lidos de um ref para não recriar o listener a cada render.
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers, enabled = true): void {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      const { onNext, onPrevious, onOpen, onFocusSearch, onEscape, onToggleTheme } =
        handlersRef.current;

      if (event.key === 'Escape') {
        onEscape?.();
        return;
      }

      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'j':
          event.preventDefault();
          onNext?.();
          break;
        case 'k':
          event.preventDefault();
          onPrevious?.();
          break;
        case 'Enter':
          onOpen?.();
          break;
        case '/':
          event.preventDefault();
          onFocusSearch?.();
          break;
        case 't':
          onToggleTheme?.();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);
}
