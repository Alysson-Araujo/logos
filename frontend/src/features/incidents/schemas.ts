import { z } from 'zod';
import type { ZodType, ZodTypeDef } from 'zod';

import { ApiError } from '@/lib/http';

import {
  INCIDENT_CATEGORIES,
  INCIDENT_CRITICALITIES,
  INCIDENT_SORTS,
  INCIDENT_STATUSES,
  RESOLUTION_NOTES_MIN_LENGTH,
  isClosedStatus,
} from './types';

/**
 * Schemas Zod espelhando o contrato. O front não confia cegamente no JSON:
 * valida em runtime e transforma divergência em erro de contrato (`errorFatal`).
 */

const nullableString = z.string().nullish().default(null);
const nullableNumber = z.number().nullish().default(null);

export const incidentSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  title: z.string(),
  description: nullableString,
  category: z.enum(INCIDENT_CATEGORIES),
  criticality: z.enum(INCIDENT_CRITICALITIES),
  status: z.enum(INCIDENT_STATUSES),
  latitude: nullableNumber,
  longitude: nullableNumber,
  locationLabel: nullableString,
  truckPlate: nullableString,
  driverName: nullableString,
  reportedBy: z.string().default('Não informado'),
  assignedAnalyst: nullableString,
  resolutionNotes: nullableString,
  priorityScore: z.number(),
  slaDueAt: z.string(),
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closedAt: nullableString,
});

export const incidentPageInfoSchema = z.object({
  nextCursor: nullableString,
  hasNextPage: z.boolean(),
  limit: z.number().int().positive(),
});

export const incidentListResponseSchema = z.object({
  items: z.array(incidentSchema),
  pageInfo: incidentPageInfoSchema,
  meta: z.object({
    total: z.number().int().nonnegative(),
    appliedFilters: z.record(z.unknown()).default({}),
  }),
});

/** Envelope único de erro da API (seção 6.3). */
export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().nullish().default(null),
    requestId: z.string(),
    timestamp: z.string(),
  }),
});

export const metaEnumsSchema = z.object({
  categories: z.array(z.object({ value: z.string(), label: z.string() })),
  criticalities: z.array(z.object({ value: z.string(), label: z.string() })),
  statuses: z.array(z.object({ value: z.string(), label: z.string() })),
  sorts: z.array(z.object({ value: z.enum(INCIDENT_SORTS), label: z.string() })).optional(),
});

/** Corpo de `POST /incidents/{id}/status` com a regra de justificativa obrigatória. */
export const statusChangeRequestSchema = z
  .object({
    status: z.enum(INCIDENT_STATUSES),
    resolutionNotes: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (!isClosedStatus(value.status)) return;
    const notes = value.resolutionNotes ?? '';
    if (notes.trim().length < RESOLUTION_NOTES_MIN_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['resolutionNotes'],
        message: `Justificativa obrigatória com pelo menos ${String(RESOLUTION_NOTES_MIN_LENGTH)} caracteres.`,
      });
    }
  });

export const incidentCreateSchema = z.object({
  title: z.string().trim().min(5).max(120),
  category: z.enum(INCIDENT_CATEGORIES),
  criticality: z.enum(INCIDENT_CRITICALITIES),
  description: z.string().trim().max(2000).optional(),
  locationLabel: z.string().trim().max(160).optional(),
  truckPlate: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/,
      'Placa inválida (use o padrão Mercosul, ex.: QRD1A23).',
    )
    .optional(),
  driverName: z.string().trim().max(120).optional(),
  reportedBy: z.string().trim().min(2).max(80),
});

export const healthSchema = z.object({ status: z.string() }).passthrough();

/**
 * Valida o payload contra o schema. Divergência vira `ApiError` de contrato,
 * que a UI mostra como `errorFatal` com "Copiar detalhes técnicos".
 */
export function parseContract<TOutput>(
  schema: ZodType<TOutput, ZodTypeDef, unknown>,
  payload: unknown,
): TOutput {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ApiError({
      status: 0,
      code: 'CONTRACT_ERROR',
      message: 'A resposta da API não corresponde ao contrato esperado.',
      kind: 'contract',
      details: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/** Mensagem legível do resultado de um schema de formulário. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Dados inválidos.';
}
