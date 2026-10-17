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
  user: authUserSchema,
});

/** Formulário: a validação local é conveniência, a API é a autoridade. */
export const loginFormSchema = z.object({
  email: z.string().trim().min(1, 'Informe o e-mail.').email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;

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
