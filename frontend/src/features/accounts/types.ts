import { AUTH_ROLES, type AuthRole } from '@/features/auth/types';

/**
 * Contas de acesso — contrato de `GET/POST/PATCH /users` (issue #127).
 *
 * O papel é o mesmo `AuthRole` da sessão: a administração escolhe entre os
 * mesmos três valores que a autorização conhece.
 */
export const ACCOUNT_ROLES = AUTH_ROLES;

export type AccountRole = AuthRole;

/** Item de `GET /users` (`UserSummary`). */
export interface AccountSummary {
  id: string;
  name: string;
  email: string;
  role: AccountRole;
  isActive: boolean;
  /** Convite dentro do prazo que ainda não foi usado. */
  invitePending: boolean;
  /** Instante do acesso anterior; `null` quando a conta nunca entrou. */
  lastLoginAt: string | null;
  createdAt: string;
}

/** Resposta de `POST /users` (`InvitedUserRead`) — nunca traz a senha. */
export interface InvitedAccount {
  id: string;
  email: string;
  role: AccountRole;
  inviteExpiresAt: string;
}

export interface CreateAccountInput {
  email: string;
  role: AccountRole;
}

/**
 * Situação exibida na tabela.
 *
 * `invitePending` vence `isActive`: a conta recém-criada nasce inativa, mas o
 * que interessa a quem administra é que o convite está no ar.
 */
export type AccountSituation = 'active' | 'pending' | 'inactive';

/** `ALL` é o "Todos os papéis" da barra de filtros. */
export const ALL_ROLES = 'ALL';

export type AccountRoleFilter = AccountRole | typeof ALL_ROLES;

/** Convite recém-enviado: estado de sessão da tela, não persistido. */
export interface InviteNotice {
  accountId: string;
  email: string;
}
