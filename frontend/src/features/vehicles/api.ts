import { parseContract } from '@/features/incidents/schemas';
import { httpClient } from '@/lib/http';

import { vehicleSearchSchema } from './schemas';
import type { VehicleSearchResult } from './types';

const VEHICLES_PATH = '/vehicles';

/** Quantas sugestões pedir por consulta. O teto do servidor é 25. */
export const PLATE_SUGGESTION_LIMIT = 8;

/**
 * `GET /vehicles?q=...` — sugere placas pelo início do código.
 *
 * `limit` é pequeno de propósito: a lista é sugestão para um campo de
 * formulário, não um catálogo para navegar. Oito cabem na tela sem rolar, e o
 * campo continua mostrando o essencial — placa, modelo e transportadora.
 */
export async function fetchVehicles(
  query: string,
  signal?: AbortSignal,
): Promise<VehicleSearchResult> {
  const raw = await httpClient.get(VEHICLES_PATH, {
    signal,
    query: { q: query, limit: PLATE_SUGGESTION_LIMIT },
  });
  return parseContract(vehicleSearchSchema, raw);
}
