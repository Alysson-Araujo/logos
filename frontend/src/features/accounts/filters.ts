import { ALL_ROLES, type AccountRoleFilter, type AccountSummary } from './types';

/**
 * Filtro da barra: papel e busca por nome/e-mail.
 *
 * `GET /users` não tem parâmetros de filtro, então tudo acontece em memória. A
 * normalização é a mesma dos dois lados (minúsculas, sem espaços nas pontas)
 * para "Joana" e " joana " darem o mesmo resultado.
 */
export function filterAccounts(
  accounts: readonly AccountSummary[],
  search: string,
  roleFilter: AccountRoleFilter,
): AccountSummary[] {
  const term = search.trim().toLowerCase();
  return accounts.filter((account) => {
    if (roleFilter !== ALL_ROLES && account.role !== roleFilter) return false;
    if (term === '') return true;
    return `${account.name} ${account.email}`.toLowerCase().includes(term);
  });
}

/** Contas com convite dentro do prazo — o "M convites pendentes" da barra. */
export function countPendingInvites(accounts: readonly AccountSummary[]): number {
  return accounts.filter((account) => account.invitePending).length;
}
