import { HttpResponse, http } from 'msw';

import { ACCOUNT_ROLES, type AccountSummary } from '@/features/accounts/types';
import type { AuthRole } from '@/features/auth/types';

import { apiError, apiPath, simulateLatency } from './http';

/**
 * API simulada da administração de contas — espelha `GET/POST/PATCH /users` e
 * `POST /users/{id}/invite` do backend (#127), inclusive os erros que a tela
 * precisa saber tratar: `409 EMAIL_ALREADY_EXISTS`, `422 VALIDATION_ERROR` e
 * `403 INSUFFICIENT_ROLE`.
 *
 * O "banco" é em memória e o seed é o mesmo da API real (`app/infra/seed.py`),
 * então entrar com `admin@autou.com.br` no modo de desenvolvimento mostra as
 * mesmas contas que o backend mostraria.
 */

/** Senha temporária: 16 caracteres, sem ambíguos (`l o O 0 1 I`). */
export const INVITE_PASSWORD_LENGTH = 16;
const INVITE_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_TTL_HOURS = 24;

/** E-mail aceito: mesmo `EMAIL_PATTERN` (permissivo) do backend. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

interface MockAccount extends AccountSummary {
  /** O mock não faz hash: a senha precisa existir para o login simulado. */
  password: string | null;
  /** Senha temporária do convite (nunca sai em resposta HTTP). */
  tempPassword: string | null;
  inviteExpiresAt: string | null;
}

let accounts: MockAccount[] | null = null;

/**
 * Última conta autenticada no mock.
 *
 * O token simulado não carrega identidade (o formato `mock-token-<epoch>` é
 * fixado em teste), então a troca de senha usa este atalho para saber de quem
 * concluir o convite. Serve só ao modo de demonstração.
 */
let lastAuthenticatedEmail: string | null = null;

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

function daysAgo(days: number): string {
  return hoursAgo(days * 24);
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

/** Mesmas quatro contas do seed da API (senhas `<primeiro>.logos2026`). */
function createSeedAccounts(): MockAccount[] {
  return [
    {
      id: 'mock-user-ana',
      name: 'Ana Paula Ribeiro',
      email: 'ana@autou.com.br',
      role: 'ANALYST',
      isActive: true,
      invitePending: false,
      lastLoginAt: null,
      createdAt: daysAgo(90),
      password: 'ana.logos2026',
      tempPassword: null,
      inviteExpiresAt: null,
    },
    {
      id: 'mock-user-carlos',
      name: 'Carlos Eduardo Lima',
      email: 'carlos@autou.com.br',
      role: 'ANALYST',
      isActive: true,
      invitePending: false,
      lastLoginAt: hoursAgo(26),
      createdAt: daysAgo(88),
      password: 'carlos.logos2026',
      tempPassword: null,
      inviteExpiresAt: null,
    },
    {
      id: 'mock-user-marina',
      name: 'Marina Souza',
      email: 'marina@autou.com.br',
      role: 'REPORTER',
      isActive: true,
      invitePending: false,
      lastLoginAt: daysAgo(12),
      createdAt: daysAgo(60),
      password: 'marina.logos2026',
      tempPassword: null,
      inviteExpiresAt: null,
    },
    {
      id: 'mock-user-admin',
      name: 'Administrador Logos',
      email: 'admin@autou.com.br',
      role: 'ADMIN',
      isActive: true,
      invitePending: false,
      lastLoginAt: hoursAgo(2),
      createdAt: daysAgo(90),
      password: 'admin.logos2026',
      tempPassword: null,
      inviteExpiresAt: null,
    },
  ];
}

function database(): MockAccount[] {
  accounts ??= createSeedAccounts();
  return accounts;
}

export function resetMockAccounts(): void {
  accounts = createSeedAccounts();
  lastAuthenticatedEmail = null;
}

function isInvitePending(account: MockAccount): boolean {
  if (account.tempPassword === null || account.inviteExpiresAt === null) return false;
  return Date.parse(account.inviteExpiresAt) > Date.now();
}

/** `UserSummary`: o que sai na API, sem senha nem hash. */
function toSummary(account: MockAccount): AccountSummary {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    isActive: account.isActive,
    invitePending: isInvitePending(account),
    lastLoginAt: account.lastLoginAt,
    createdAt: account.createdAt,
  };
}

function generateInvitePassword(): string {
  let password = '';
  for (let index = 0; index < INVITE_PASSWORD_LENGTH; index += 1) {
    const position = Math.floor(Math.random() * INVITE_ALPHABET.length);
    password += INVITE_ALPHABET[position] ?? 'k';
  }
  return password;
}

/** `joana.prado` → `Joana Prado`, como o servidor deriva o nome. */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter((part) => part !== '')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export interface MockAuthentication {
  account: AccountSummary;
  role: AuthRole;
  /** `true` quando a senha usada é a temporária do convite. */
  mustChangePassword: boolean;
  /** Acesso anterior, devolvido antes de registrar o atual. */
  previousLoginAt: string | null;
}

/**
 * Login simulado: senha definitiva ou temporária do convite.
 *
 * Os dois caminhos não se misturam, como no backend: a temporária entra **mesmo
 * com a conta ainda inativa** (ela nasce inativa de propósito), mas só serve
 * para definir a senha — e não registra acesso, senão o convite deixaria de
 * constar como pendente antes de a pessoa concluir o primeiro acesso.
 */
export function authenticateMockAccount(
  email: string,
  password: string,
): MockAuthentication | null {
  const normalizado = email.trim().toLowerCase();
  const account = database().find((candidate) => candidate.email === normalizado);
  if (account === undefined) return null;

  if (account.tempPassword !== null && account.tempPassword === password) {
    // Convite vencido: a temporária simplesmente não vale mais.
    if (!isInvitePending(account)) return null;
    lastAuthenticatedEmail = account.email;
    return {
      account: toSummary(account),
      role: account.role,
      mustChangePassword: true,
      previousLoginAt: null,
    };
  }

  if (account.password === null || account.password !== password || !account.isActive) {
    return null;
  }

  const previousLoginAt = account.lastLoginAt;
  account.lastLoginAt = new Date().toISOString();
  lastAuthenticatedEmail = account.email;

  return {
    account: toSummary(account),
    role: account.role,
    mustChangePassword: false,
    previousLoginAt,
  };
}

/** Usado pelos testes quando precisam da senha temporária gerada pelo mock. */
export function readMockInvitePassword(email: string): string | null {
  const normalizado = email.trim().toLowerCase();
  return database().find((candidate) => candidate.email === normalizado)?.tempPassword ?? null;
}

export function readLastAuthenticatedEmail(): string | null {
  return lastAuthenticatedEmail;
}

/**
 * A senha vigente da conta confere? Vale a definitiva (só em conta ativa) e a
 * temporária do convite ainda não vencido — as mesmas regras de
 * `authenticateMockAccount`, mas **sem** efeito colateral de login.
 */
export function checkMockPassword(email: string, password: string): boolean {
  const normalizado = email.trim().toLowerCase();
  const account = database().find((candidate) => candidate.email === normalizado);
  if (account === undefined) return false;

  if (account.tempPassword !== null && account.tempPassword === password) {
    return isInvitePending(account);
  }

  return account.isActive && account.password !== null && account.password === password;
}

/**
 * A conta cuja senha vigente é `password`.
 *
 * Serve à troca de senha quando o teste monta a sessão direto no store (sem
 * passar pelo login): o token do mock não carrega identidade, então a própria
 * senha atual é o que identifica de quem concluir o convite.
 */
export function findMockAccountByPassword(password: string): string | null {
  const account = database().find((candidate) => checkMockPassword(candidate.email, password));
  return account?.email ?? null;
}

/**
 * Troca de senha simulada: a temporária deixa de valer, a senha definitiva
 * passa a valer e a conta é ativada — o mesmo efeito de `complete_invite`.
 */
export function completeMockPasswordChange(email: string | null, newPassword: string): void {
  if (email === null) return;
  const normalizado = email.trim().toLowerCase();
  const account = database().find((candidate) => candidate.email === normalizado);
  if (account === undefined) return;
  account.password = newPassword;
  account.isActive = true;
  account.tempPassword = null;
  account.inviteExpiresAt = null;
}

function readField(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as Record<string, unknown>)[key];
}

function readEmail(body: unknown): string {
  const value = readField(body, 'email');
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readRole(body: unknown): AuthRole | null {
  const value = readField(body, 'role');
  return ACCOUNT_ROLES.find((candidate) => candidate === value) ?? null;
}

function validationError(field: string, message: string) {
  return apiError(422, 'VALIDATION_ERROR', 'A requisição contém dados inválidos.', {
    validationErrors: [{ loc: ['body', field], msg: message, type: 'value_error' }],
  });
}

/**
 * Sem servidor de e-mail, a senha temporária sai no console: é o único jeito
 * de percorrer o primeiro acesso no modo de demonstração. Em teste, o silêncio
 * é proposital — a suíte não vale como "caixa de entrada".
 */
function announceInvite(email: string, tempPassword: string, isResend = false): void {
  if (import.meta.env.MODE === 'test') return;
  const acao = isResend ? 'convite reenviado para' : 'convite simulado para';
  console.warn(
    `[Logos] ${acao} ${email} — senha temporária: ${tempPassword} (expira em ${String(INVITE_TTL_HOURS)}h)`,
  );
}

export const accountHandlers = [
  http.get(apiPath('/users'), async () => {
    await simulateLatency();
    return HttpResponse.json(database().map(toSummary));
  }),

  http.post(apiPath('/users'), async ({ request }) => {
    await simulateLatency();
    const body: unknown = await request.json().catch(() => null);
    const email = readEmail(body);
    const role = readRole(body);

    if (!EMAIL_PATTERN.test(email)) return validationError('email', 'Informe um e-mail válido.');
    if (role === null) return validationError('role', 'Informe um papel válido.');
    if (database().some((candidate) => candidate.email === email)) {
      return apiError(409, 'EMAIL_ALREADY_EXISTS', 'Já existe uma conta com este e-mail.', {
        email,
      });
    }

    const tempPassword = generateInvitePassword();
    const inviteExpiresAt = hoursFromNow(INVITE_TTL_HOURS);
    const created: MockAccount = {
      id: `mock-user-${String(Date.now())}`,
      name: nameFromEmail(email),
      email,
      role,
      isActive: false,
      invitePending: true,
      lastLoginAt: null,
      createdAt: new Date().toISOString(),
      password: null,
      tempPassword,
      inviteExpiresAt,
    };
    database().unshift(created);

    announceInvite(email, tempPassword);

    return HttpResponse.json(
      { id: created.id, email: created.email, role: created.role, inviteExpiresAt },
      { status: 201 },
    );
  }),

  http.post(apiPath('/users/:id/invite'), async ({ params }) => {
    await simulateLatency();
    const id = typeof params.id === 'string' ? params.id : '';
    const account = database().find((candidate) => candidate.id === id);
    if (account === undefined) {
      return apiError(404, 'USER_NOT_FOUND', 'Usuário não encontrado.', { id });
    }

    account.tempPassword = generateInvitePassword();
    account.inviteExpiresAt = hoursFromNow(INVITE_TTL_HOURS);
    account.isActive = false;
    announceInvite(account.email, account.tempPassword, true);
    return new HttpResponse(null, { status: 204 });
  }),

  http.patch(apiPath('/users/:id'), async ({ params, request }) => {
    await simulateLatency();
    const id = typeof params.id === 'string' ? params.id : '';
    const account = database().find((candidate) => candidate.id === id);
    if (account === undefined) {
      return apiError(404, 'USER_NOT_FOUND', 'Usuário não encontrado.', { id });
    }

    const body: unknown = await request.json().catch(() => null);
    const isActive = readField(body, 'isActive');
    if (typeof isActive !== 'boolean') {
      return validationError('isActive', 'Informe a situação da conta.');
    }

    account.isActive = isActive;
    if (!isActive) {
      // Desativar invalida o convite pendente, como no backend.
      account.tempPassword = null;
      account.inviteExpiresAt = null;
    }
    return HttpResponse.json(toSummary(account));
  }),
];

/**
 * `403` de papel, para demonstrar/testar a tela sem permissão:
 * `server.use(forbiddenAccountsHandler)`.
 */
export const forbiddenAccountsHandler = http.get(apiPath('/users'), () =>
  apiError(403, 'INSUFFICIENT_ROLE', 'Seu perfil não tem permissão para esta ação.', {
    requiredRole: 'ADMIN',
  }),
);

/** `403 PASSWORD_CHANGE_REQUIRED`, vindo de uma rota comum. */
export const passwordChangeRequiredHandler = http.get(apiPath('/users'), () =>
  apiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Defina sua senha para liberar o acesso.'),
);
