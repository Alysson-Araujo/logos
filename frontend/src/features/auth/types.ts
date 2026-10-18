/**
 * Tipos da sessão autenticada (contrato fechado com a autenticação da API).
 *
 * O papel chega em maiúsculas (`ANALYST`) porque é valor de domínio; a
 * interface exibe o rótulo em minúsculas, como no frame do Figma
 * ("Alysson · analista").
 */
export const AUTH_ROLES = ['REPORTER', 'ANALYST', 'ADMIN'] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  /** Instante do acesso **anterior**; `null` no primeiro login. */
  lastLoginAt: string | null;
}

/** Sessão guardada na aba: token, validade calculada e usuário. */
export interface AuthSession {
  accessToken: string;
  tokenType: 'Bearer';
  /** Validade em segundos, como veio da API. */
  expiresIn: number;
  /** Expiração em epoch ms, calculada no login — evita 401 previsível. */
  expiresAt: number;
  /**
   * `true` quando a sessão entrou com a senha temporária do convite. Nesse
   * estado a API só responde `change-password`, `me` e o logout: a interface
   * troca a triagem pela tela de definir senha.
   */
  mustChangePassword: boolean;
  user: AuthUser;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * Troca de senha do próprio usuário. No primeiro acesso a `currentPassword` é
 * a temporária que veio por e-mail — ela só existe em memória, nunca no
 * `sessionStorage`.
 */
export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

/**
 * Por que a sessão terminou. Vira a mensagem da tela de login: `expired`
 * não é o mesmo que `manual` — quem foi expulso precisa saber que foi.
 */
export type SignOutReason = 'expired' | 'manual';
