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

/** Placas Mercosul (AAA1A23) e antigas (AAA1234) — mesma regra de `incident.py`. */
export const PLATE_PATTERN = /^(?:[A-Z]{3}\d{4}|[A-Z]{3}\d[A-Z]\d{2})$/;
/** Separadores aceitos na digitação e removidos na normalização. */
const PLATE_SEPARATORS = /[\s-]+/g;
/** O backend recusa marcação HTML no título de um canal de origem externo. */
const HTML_MARKERS = /[<>]/;

/**
 * Campo de texto opcional: `trim`, teto de caracteres e vazio → `undefined`,
 * para o opcional em branco não virar string vazia no registro.
 */
function optionalText(maxLength: number, message: string) {
  return z
    .string()
    .trim()
    .max(maxLength, message)
    .transform((value) => (value === '' ? undefined : value))
    .optional();
}

/** Os oito campos do formulário de criação, na ordem em que aparecem na sheet. */
export const CREATE_INCIDENT_FIELDS = [
  'title',
  'category',
  'criticality',
  'description',
  'locationLabel',
  'truckPlate',
  'driverName',
  'reportedBy',
] as const;

export type CreateIncidentField = (typeof CREATE_INCIDENT_FIELDS)[number];

/**
 * Corpo de `POST /incidents`, espelhando `IncidentCreate`:
 * título 3–120 sem marcação HTML, enums obrigatórios, opcionais com teto de
 * caracteres e placa normalizada (maiúscula, sem espaço ou hífen).
 *
 * O `.trim()` roda antes do `.min()`, e todo opcional em branco sai como
 * `undefined` — quem decide o que vai no corpo é `buildCreateBody`.
 */
export const incidentCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'Informe o título com pelo menos 3 caracteres.')
    .max(120, 'O título pode ter no máximo 120 caracteres.')
    .refine((value) => !HTML_MARKERS.test(value), 'O título não pode conter marcação HTML.'),
  category: z.enum(INCIDENT_CATEGORIES, {
    errorMap: () => ({ message: 'Selecione a categoria.' }),
  }),
  criticality: z.enum(INCIDENT_CRITICALITIES, {
    errorMap: () => ({ message: 'Selecione a criticidade.' }),
  }),
  description: optionalText(2000, 'A descrição pode ter no máximo 2000 caracteres.'),
  locationLabel: optionalText(160, 'O local pode ter no máximo 160 caracteres.'),
  truckPlate: z
    .string()
    .transform((value) => value.replace(PLATE_SEPARATORS, '').toUpperCase())
    .refine(
      (value) => value === '' || PLATE_PATTERN.test(value),
      'Placa inválida (use o padrão Mercosul, ex.: QRD1A23, ou o antigo, ex.: QRD1234).',
    )
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  driverName: optionalText(120, 'O motorista pode ter no máximo 120 caracteres.'),
  reportedBy: z
    .string()
    .trim()
    .min(2, 'Informe o canal de origem — de 2 a 80 caracteres.')
    .max(80, 'Informe o canal de origem — de 2 a 80 caracteres.'),
});

/** Payload pronto para o `POST /incidents` (saída do schema, já normalizada). */
export type IncidentCreateInput = z.infer<typeof incidentCreateSchema>;

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
