import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useToast } from '@/hooks/useToast';
import { createIdempotencyKey, type ApiError } from '@/lib/http';

import { createIncident } from '../api/endpoints';
import { CRITICALITY_LABELS } from '../labels';
import type { Incident, NewIncidentInput } from '../types';
import { incidentQueryKeys } from './useIncidents';

/**
 * `POST /incidents` — criação de incidente.
 *
 * Sem retry automático (mutação não repete sozinha) e com `Idempotency-Key`
 * por tentativa: um clique duplo ou um reenvio manual não abre dois casos.
 * Lista e KPIs são invalidados em `onSettled`, inclusive quando o envio falha
 * depois de o servidor ter gravado — o cache nunca fica à frente do servidor.
 */
export function useCreateIncident() {
  const queryClient = useQueryClient();
  const pushToast = useToast();

  return useMutation<Incident, ApiError, NewIncidentInput>({
    mutationFn: (input) => createIncident({ input, idempotencyKey: createIdempotencyKey() }),

    onSuccess: (incident) => {
      pushToast({
        variant: 'success',
        title: 'Incidente registrado',
        description: `${incident.code} entrou na fila como ${CRITICALITY_LABELS[incident.criticality]}.`,
      });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: incidentQueryKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: incidentQueryKeys.counters() });
    },
  });
}

export type CreateIncidentMutation = ReturnType<typeof useCreateIncident>;
