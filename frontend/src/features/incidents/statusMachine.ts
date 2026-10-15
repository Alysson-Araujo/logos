import type { IncidentStatus } from './types';

/**
 * Máquina de estados espelhada do backend (seção 4.2 do plano).
 * O front desabilita o que é inválido; a API rejeita com `422` se algo escapar.
 */
export const ALLOWED_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  ABERTO: ['EM_INVESTIGACAO', 'FECHADO', 'INCONCLUSIVO'],
  EM_INVESTIGACAO: ['FECHADO', 'INCONCLUSIVO', 'ABERTO'],
  INCONCLUSIVO: ['EM_INVESTIGACAO', 'FECHADO'],
  FECHADO: [],
};

export function getAllowedTransitions(status: IncidentStatus): readonly IncidentStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export function isTransitionAllowed(from: IncidentStatus, to: IncidentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** `FECHADO` é terminal: reabrir exige um novo incidente vinculado. */
export function isTerminalStatus(status: IncidentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
