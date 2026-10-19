import { useQuery } from '@tanstack/react-query';

import { STALE_TIME_MS } from '@/lib/queryClient';

import { fetchIncidentEvents } from '../api/endpoints';
import type { IncidentTimelineResponse } from '../types';
import { incidentQueryKeys } from './useIncidents';

/**
 * Timeline de auditoria de um incidente.
 *
 * **Por que `staleTime` curto aqui, e não o global.** O histórico de um incidente
 * muda a cada transição — e o drawer é justamente onde alguém está decidindo se
 * fecha ou não o caso. Um dado de 30 s atrás pode mostrar "Em investigação"
 * quando o servidor já está em "Fechado", e a decisão sai errada.
 *
 * `enabled` depende do id: o drawer fica montado mesmo fechado, e sem essa guarda
 * todo fechamento de painel dispararia uma leitura de histórico que ninguém vai
 * olhar.
 *
 * A ordem **não** é refeita aqui. Ela vem do servidor, que atribui a `sequence`
 * dentro da transação — é a única fonte confiável quando dois eventos caem no
 * mesmo milissegundo, e reordenar no cliente reintroduziria exatamente o defeito
 * que a coluna resolveu.
 */
export function useIncidentEvents(incidentId: string | null): {
  events: IncidentTimelineResponse['items'];
  isLoading: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: incidentQueryKeys.events(incidentId ?? ''),
    queryFn: ({ signal }) => fetchIncidentEvents(incidentId ?? '', signal),
    enabled: incidentId !== null,
    staleTime: STALE_TIME_MS / 6,
  });

  return {
    events: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
