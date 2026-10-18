/**
 * Contrato da API simulada de contas.
 *
 * O mock é o backend do modo de demonstração, então ele também precisa seguir o
 * contrato de `GET/POST/PATCH /users` (#127) — inclusive os erros que a tela
 * trata. Ambiente `node` como os outros testes de contrato: o `fetch` do Node
 * conversa com o MSW sem a ponte de `AbortSignal` do jsdom.
 *
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import {
  createAccount,
  fetchAccounts,
  resendInvite,
  setAccountActive,
} from '@/features/accounts/api';
import { changePassword, login } from '@/features/auth/api';
import { DEMO_ACCOUNTS, type DemoAccount } from '@/features/auth/demo';
import { isApiError } from '@/lib/http';

import { readMockInvitePassword } from './users';

const EMAIL = 'novo.analista@parceiro.com.br';

async function createInvited(email = EMAIL) {
  return createAccount({ email, role: 'ANALYST' });
}

describe('API simulada — contas de acesso', () => {
  it('lista as contas do seed no formato do contrato', async () => {
    const accounts = await fetchAccounts();

    expect(accounts).toHaveLength(9);
    expect(accounts.map((account) => account.email)).toEqual([
      'ana@autou.com.br',
      'carlos@autou.com.br',
      'alyssonaraujowork@gmail.com',
      'renata.lima@example.org',
      'admin@autou.com.br',
      'carlos.menezes@example.com',
      'marina@autou.com.br',
      'joana.prado@example.net',
      'marcos.tavares@example.org',
    ]);
    expect(accounts.map((account) => account.role)).toEqual([
      'ANALYST',
      'ANALYST',
      'ANALYST',
      'ANALYST',
      'ADMIN',
      'ADMIN',
      'REPORTER',
      'REPORTER',
      'REPORTER',
    ]);
    // `UserSummary` não carrega senha nem hash.
    expect(Object.keys(accounts[0] ?? {}).sort()).toEqual([
      'createdAt',
      'email',
      'id',
      'invitePending',
      'isActive',
      'lastLoginAt',
      'name',
      'role',
    ]);
  });

  it('traz a conta do convite pendente inativa e sem senha definitiva', async () => {
    const accounts = await fetchAccounts();
    const convidada = accounts.find((account) => account.email === 'marcos.tavares@example.org');

    expect(convidada).toMatchObject({ isActive: false, invitePending: true, lastLoginAt: null });
    expect(Object.keys(convidada ?? {})).not.toContain('password');
  });

  it('cria a conta como convite pendente, sem devolver senha', async () => {
    const invited = await createInvited();

    expect(invited.email).toBe(EMAIL);
    expect(invited.role).toBe('ANALYST');
    expect(Object.keys(invited).sort()).toEqual(['email', 'id', 'inviteExpiresAt', 'role']);
    // O nome é derivado do e-mail, como no servidor.
    const created = (await fetchAccounts()).find((account) => account.email === EMAIL);
    expect(created).toMatchObject({ name: 'Novo Analista', isActive: false, invitePending: true });
  });

  it('recusa e-mail repetido com 409 e o campo apontado', async () => {
    await createInvited();

    const error = await createInvited().catch((caught: unknown) => caught);

    expect(isApiError(error)).toBe(true);
    if (!isApiError(error)) throw new Error('esperava um erro tipado da API');
    expect(error.status).toBe(409);
    expect(error.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(error.details).toEqual({ email: EMAIL });
  });

  it('recusa e-mail fora de formato com 422 no campo', async () => {
    const error = await createAccount({ email: 'sem-arroba', role: 'REPORTER' }).catch(
      (caught: unknown) => caught,
    );

    expect(isApiError(error)).toBe(true);
    if (!isApiError(error)) throw new Error('esperava um erro tipado da API');
    expect(error.status).toBe(422);
    expect(error.details).toMatchObject({
      validationErrors: [{ loc: ['body', 'email'] }],
    });
  });

  it('desativa a conta e invalida o convite pendente', async () => {
    const invited = await createInvited();

    const updated = await setAccountActive(invited.id, false);

    expect(updated.isActive).toBe(false);
    expect(updated.invitePending).toBe(false);
    expect(readMockInvitePassword(EMAIL)).toBeNull();
  });

  it('reenvia o convite com uma senha temporária nova', async () => {
    const invited = await createInvited();
    const primeira = readMockInvitePassword(EMAIL);
    expect(primeira).toHaveLength(16);
    expect(primeira).not.toMatch(/[loO01I]/);

    await resendInvite(invited.id);

    const segunda = readMockInvitePassword(EMAIL);
    expect(segunda).toHaveLength(16);
    expect(segunda).not.toBe(primeira);
  });
});

describe('API simulada — credenciais de demonstração', () => {
  /**
   * As contas que a caixa "Acesso de demonstração" exibe **com senha**: as oito
   * contas ativas do seed — as do domínio do produto e as dos domínios reservados.
   *
   * A lista vem de `demo.ts` de propósito: se a tela anuncia uma credencial, o
   * login simulado tem que aceitá-la. A do convite pendente fica de fora porque
   * não tem senha para anunciar (o teste dela vem logo abaixo).
   */
  const contas = DEMO_ACCOUNTS.filter(
    (account): account is DemoAccount & { password: string } => account.password !== null,
  );

  it('anuncia oito contas com senha', () => {
    expect(contas).toHaveLength(8);
  });

  it.each(contas)('aceita $email no papel $role', async ({ email, password, role }) => {
    const session = await login({ email, password });

    expect(session.user.email).toBe(email);
    expect(session.user.role).toBe(role);
    expect(session.mustChangePassword).toBe(false);
  });

  it('aceita a senha temporária do convite pendente e exige a troca', async () => {
    const tempPassword = readMockInvitePassword('marcos.tavares@example.org');
    expect(tempPassword).not.toBeNull();

    const session = await login({
      email: 'marcos.tavares@example.org',
      password: tempPassword ?? '',
    });

    expect(session.user.role).toBe('REPORTER');
    expect(session.mustChangePassword).toBe(true);
    // A temporária não é um acesso de trabalho: o convite segue pendente.
    expect(session.user.lastLoginAt).toBeNull();
    const accounts = await fetchAccounts();
    const marcos = accounts.find((account) => account.email === 'marcos.tavares@example.org');
    expect(marcos?.invitePending).toBe(true);
  });
});

describe('API simulada — primeiro acesso', () => {
  it('a senha temporária entra em primeiro acesso e não consome o convite', async () => {
    await createInvited();
    const tempPassword = readMockInvitePassword(EMAIL);
    expect(tempPassword).not.toBeNull();

    const session = await login({ email: EMAIL, password: tempPassword ?? '' });

    expect(session.mustChangePassword).toBe(true);
    // Entrar com a temporária não é começar a trabalhar: o acesso não é
    // registrado e o convite segue pendente.
    expect(session.user.lastLoginAt).toBeNull();
    const created = (await fetchAccounts()).find((account) => account.email === EMAIL);
    expect(created?.invitePending).toBe(true);
  });

  it('a troca de senha conclui o convite e aposenta a temporária', async () => {
    await createInvited();
    const tempPassword = readMockInvitePassword(EMAIL) ?? '';
    // O mock conclui o convite da última conta autenticada (não há sessão real).
    await login({ email: EMAIL, password: tempPassword });

    await changePassword({
      currentPassword: tempPassword,
      newPassword: 'definitiva-2026-logos',
    });

    const recusada = await login({ email: EMAIL, password: tempPassword }).catch(
      (caught: unknown) => caught,
    );
    expect(isApiError(recusada) && recusada.status === 401).toBe(true);

    const session = await login({ email: EMAIL, password: 'definitiva-2026-logos' });
    expect(session.mustChangePassword).toBe(false);

    const created = (await fetchAccounts()).find((account) => account.email === EMAIL);
    expect(created).toMatchObject({ isActive: true, invitePending: false });
  });

  it('credencial desconhecida continua dando 401', async () => {
    const error = await login({ email: 'ninguem@autou.com.br', password: 'x' }).catch(
      (caught: unknown) => caught,
    );

    expect(isApiError(error)).toBe(true);
    if (!isApiError(error)) throw new Error('esperava um erro tipado da API');
    expect(error.status).toBe(401);
    expect(error.code).toBe('INVALID_CREDENTIALS');
  });
});
