import { useQuery } from '@tanstack/react-query';

import { useDebounce } from '@/hooks/useDebounce';
import { STALE_TIME_MS } from '@/lib/queryClient';

import { fetchVehicles } from '../api';

/** Chaves de cache da frota, indexadas pelo termo **já atrasado**. */
export const vehicleQueryKeys = {
  all: ['vehicles'] as const,
  search: (term: string) => [...vehicleQueryKeys.all, 'search', term] as const,
};

/**
 * Sugere placas para o campo de placa do formulário.
 *
 * O termo passa pelo `useDebounce` antes de virar consulta. Sem isso, digitar
 * `ABC1D23` dispararia sete requisições — uma por tecla — e nada garantiria que
 * a última a chegar fosse a da última tecla: uma resposta lenta de `ABC` poderia
 * sobrescrever a lista de `ABC1D2`, e a sugestão certa sumiria da tela.
 *
 * `enabled` existe para a consulta só acontecer com o combobox aberto. Buscar a
 * frota a cada formulário aberto e fechado sem uso seria requisição sem leitor.
 */
export function useVehicleSearch(term: string, enabled: boolean) {
  const debouncedTerm = useDebounce(term);

  const query = useQuery({
    queryKey: vehicleQueryKeys.search(debouncedTerm),
    queryFn: ({ signal }) => fetchVehicles(debouncedTerm, signal),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  return { ...query, debouncedTerm };
}
