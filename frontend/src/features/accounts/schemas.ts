import { z } from 'zod';

import { parseContract } from '@/features/incidents/schemas';

import { ACCOUNT_ROLES } from './types';

/**
 * Schemas Zod do contrato de contas. O front não confia cegamente no JSON: uma
 * resposta fora do formato vira erro de contrato, não tela quebrada.
 */

export const accountSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().min(3),
  role: z.enum(ACCOUNT_ROLES),
  isActive: z.boolean(),
  invitePending: z.boolean(),
  lastLoginAt: z.string().nullish().default(null),
  createdAt: z.string(),
});

export const accountListSchema = z.array(accountSummarySchema);

export const invitedAccountSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(3),
  role: z.enum(ACCOUNT_ROLES),
  inviteExpiresAt: z.string(),
});

/**
 * Formulário de nova conta.
 *
 * Só o formato do e-mail é conferido: o `EMAIL_PATTERN` da API aceita qualquer
 * domínio válido, então **não** há checagem de domínio corporativo — o convite
 * chega pelo endereço que a pessoa realmente lê.
 */
export const createAccountFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Informe o e-mail.')
    .max(160, 'Use no máximo 160 caracteres.')
    .email('Informe um e-mail válido.'),
  role: z.enum(ACCOUNT_ROLES),
});

export type CreateAccountFormValues = z.infer<typeof createAccountFormSchema>;

/** 422 da API: `error.details.validationErrors` do Pydantic. */
const validationErrorsSchema = z.object({
  validationErrors: z.array(
    z.object({
      loc: z.array(z.union([z.string(), z.number()])).default([]),
      msg: z.string().default('Dados inválidos.'),
    }),
  ),
});

export interface AccountFieldIssue {
  /** Campo do formulário que a API apontou, quando ela aponta um. */
  field: 'email' | 'role' | null;
  message: string;
}

function readFieldName(location: readonly (string | number)[]): 'email' | 'role' | null {
  const last = location[location.length - 1];
  return last === 'email' || last === 'role' ? last : null;
}

/**
 * Traduz o 422 da API para o campo certo do formulário.
 *
 * O Pydantic aponta o caminho (`body.email`); o que a tela mostra é a mensagem
 * do campo, não um erro genérico no topo.
 */
export function readValidationIssue(details: unknown): AccountFieldIssue | null {
  const parsed = validationErrorsSchema.safeParse(details);
  if (!parsed.success) return null;
  const first = parsed.data.validationErrors[0];
  if (first === undefined) return null;
  return { field: readFieldName(first.loc), message: first.msg };
}

export { parseContract };
