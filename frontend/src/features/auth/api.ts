import { parseContract } from '@/features/incidents/schemas';
import { httpClient } from '@/lib/http';

import { loginResponseSchema, toAuthUser } from './schemas';
import type { AuthSession, LoginCredentials } from './types';

/**
 * Margem só do login. A API no plano gratuito hiberna depois de ~15 minutos
 * ociosos e pode levar dezenas de segundos para acordar: 45 s evitam dizer
 * "credenciais inválidas" para uma API que apenas estava dormindo. As demais
 * chamadas seguem com o timeout padrão do cliente.
 */
export const LOGIN_TIMEOUT_MS = 45_000;

/** Revogação é higiene: não vale segurar a interface esperando por ela. */
export const LOGOUT_TIMEOUT_MS = 5_000;

/** A troca de senha roda o Argon2 dos dois lados; o padrão do cliente é curto. */
export const CHANGE_PASSWORD_TIMEOUT_MS = 15_000;

export async function login(
  credentials: LoginCredentials,
  signal?: AbortSignal,
): Promise<AuthSession> {
  const payload = await httpClient.post('/auth/login', credentials, {
    // Sem token por definição: é esta chamada que o produz. A dispensa é o
    // que impede o 401 de "senha errada" de derrubar uma sessão existente.
    skipAuth: true,
    timeoutMs: LOGIN_TIMEOUT_MS,
    signal,
  });
  const response = parseContract(loginResponseSchema, payload);

  return {
    accessToken: response.accessToken,
    tokenType: response.tokenType,
    expiresIn: response.expiresIn,
    expiresAt: Date.now() + response.expiresIn * 1000,
    user: toAuthUser(response.user),
  };
}

/**
 * Pede a revogação do token atual na API.
 *
 * Falha aqui não pode impedir a saída: quem clicou em "Sair" já saiu, e o
 * token expira sozinho. Por isso o erro é engolido de propósito.
 */
export async function revokeSessionToken(): Promise<void> {
  try {
    await httpClient.request({
      path: '/auth/logout',
      method: 'POST',
      timeoutMs: LOGOUT_TIMEOUT_MS,
    });
  } catch {
    // Best effort deliberado: ver comentário acima.
  }
}

/** Corpo de `POST /auth/change-password` — camelCase, como o `CamelModel` da API. */
export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

/**
 * Troca a senha do próprio usuário. Diferente do logout, a falha **importa**:
 * a pessoa precisa saber que a senha não mudou, então o erro sobe tipado.
 */
export async function changePassword(payload: ChangePasswordPayload): Promise<void> {
  await httpClient.post('/auth/change-password', payload, {
    timeoutMs: CHANGE_PASSWORD_TIMEOUT_MS,
    // 401 aqui é "senha atual errada", não sessão perdida: sem esta dispensa,
    // um erro de digitação expulsaria a pessoa para a tela de login.
    ignoreUnauthorized: true,
  });
}
