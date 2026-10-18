import { z } from 'zod';

/**
 * Schemas Zod do contrato de frota.
 *
 * O front não confia cegamente no JSON: uma resposta fora do formato vira erro
 * de contrato, não uma lista de sugestões com campos `undefined` na tela.
 */

export const vehicleSchema = z.object({
  id: z.string().min(1),
  // Entre 7 e 8: o padrão antigo (`AAA1234`) tem 7 e o Mercosul (`AAA1A23`) tem
  // 8. Qualquer outra coisa é resposta fora do contrato.
  plate: z.string().min(7).max(8),
  model: z.string().min(1),
  carrier: z.string().min(1),
});

export const vehicleSearchSchema = z.object({
  items: z.array(vehicleSchema),
  total: z.number().int().nonnegative(),
});
