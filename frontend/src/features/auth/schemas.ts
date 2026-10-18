import { z } from 'zod';

import { AUTH_ROLES, type AuthUser } from './types';

/** Usuário como a API devolve em `/auth/login`. */
export const authUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(3),
  name: z.string().min(1),
  role: z.enum(AUTH_ROLES),
  lastLoginAt: z.string().nullish(),
});

/** Corpo de `POST /auth/login`. */
export const loginResponseSchema = z.object({
  accessToken: z.string().min(10),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
  /**
   * `true` quando a senha usada é a temporária do convite. O padrão é `false`
   * para uma resposta antiga do servidor não prender ninguém na tela de senha.
   */
  mustChangePassword: z.boolean().default(false),
  user: authUserSchema,
});

/**
 * O que fica em `sessionStorage`. O conteúdo do storage é dado de entrada
 * como qualquer outro: é validado de novo na leitura, porque o usuário (ou
 * outra aba) pode tê-lo editado.
 */
export const storedSessionSchema = z.object({
  accessToken: z.string().min(10),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  mustChangePassword: z.boolean().default(false),
  user: authUserSchema,
});

/** Formulário: a validação local é conveniência, a API é a autoridade. */
export const loginFormSchema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail.').email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

/**
 * Política real da API (`app/domain/accounts.py`): mínimo de 12 e máximo de
 * 128, **sem** exigir símbolo, maiúscula ou dígito. A interface repete o que o
 * servidor aplica — nem mais, nem menos.
 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Campos comuns aos dois formulários de senha: as regras são locais porque a
 * pessoa não deve descobrir a política só depois de um 422 — a API continua
 * sendo a autoridade.
 */
const newPasswordFields = {
  newPassword: z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      `A senha deve ter ao menos ${String(PASSWORD_MIN_LENGTH)} caracteres.`,
    ),
  confirmPassword: z.string().min(1, 'Confirme a nova senha.'),
};

/**
 * Troca **voluntária** pelo menu do usuário (#126): a pessoa já está
 * autenticada, então a API exige a senha vigente junto da nova.
 */
export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.'),
    ...newPasswordFields,
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'As senhas não conferem.',
    path: ['confirmPassword'],
  });

/**
 * Primeiro acesso obrigatório do convite (#128). Não há campo de senha atual: a
 * temporária foi digitada no login e vive só em memória — a tela a envia como
 * `currentPassword` sem pedir de novo.
 */
export const firstAccessPasswordFormSchema = z
  .object(newPasswordFields)
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'As senhas não conferem.',
    path: ['confirmPassword'],
  });

export type LoginFormValues = z.infer<typeof loginFormSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;

/** Normaliza `lastLoginAt` ausente para `null`, como o contrato manda. */
export function toAuthUser(payload: z.infer<typeof authUserSchema>): AuthUser {
  return {
    id: payload.id,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    lastLoginAt: payload.lastLoginAt ?? null,
  };
}
