import type { AuthSession, AuthUser } from '@/features/auth/types';

/**
 * Sessão de teste com a forma exata do contrato, para os testes que precisam
 * de alguém logado sem passar pela tela de login.
 */
export function createTestSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    accessToken: 'token-de-teste-123456',
    tokenType: 'Bearer',
    expiresIn: 28_800,
    expiresAt: Date.now() + 28_800_000,
    mustChangePassword: false,
    user: {
      id: 'user-ana',
      email: 'ana@autou.com.br',
      name: 'Ana Paula Ribeiro',
      role: 'ANALYST',
      lastLoginAt: null,
    },
    ...overrides,
  };
}

/** Sessão de administrador: é ela que abre a administração de contas. */
export function createAdminSession(overrides: Partial<AuthUser> = {}): AuthSession {
  return createTestSession({
    user: {
      id: 'user-admin',
      email: 'admin@autou.com.br',
      name: 'Administrador Logos',
      role: 'ADMIN',
      lastLoginAt: null,
      ...overrides,
    },
  });
}
