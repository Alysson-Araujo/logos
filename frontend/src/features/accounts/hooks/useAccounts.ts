import { useQuery } from '@tanstack/react-query';

import { STALE_TIME_MS } from '@/lib/queryClient';

import { fetchAccounts } from '../api';

/** Chaves de cache das contas: uma lista só, sem parâmetros. */
export const accountQueryKeys = {
  all: ['accounts'] as const,
  list: () => [...accountQueryKeys.all, 'list'] as const,
};

/**
 * Lista as contas.
 *
 * Não há paginação nem filtro no servidor: `GET /users` devolve tudo e a barra
 * de busca filtra em memória. O `403` não é repetido — `shouldRetryQuery` só
 * repete transporte e 5xx, e papel insuficiente não melhora na segunda vez.
 */
export function useAccounts() {
  return useQuery({
    queryKey: accountQueryKeys.list(),
    queryFn: ({ signal }) => fetchAccounts(signal),
    staleTime: STALE_TIME_MS,
  });
}
