import { useEffect, useState } from 'react';

/** Atraso padrão da busca textual (seção 8.4). */
export const SEARCH_DEBOUNCE_MS = 300;

/** Devolve `value` apenas depois de `delayMs` sem mudanças. */
export function useDebounce<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
