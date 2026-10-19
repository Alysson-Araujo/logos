import { ArrowLeft, CircleCheckBig, TriangleAlert, UserCheck } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useAppView } from '@/app/useAppView';
import { ErrorState } from '@/components/feedback/ErrorState';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/hooks/useDebounce';

import { countPendingInvites, filterAccounts } from '../filters';
import { useResendInvite, useSetAccountActive } from '../hooks/useAccountMutations';
import { useAccounts } from '../hooks/useAccounts';
import { formatAccountsSummary, isPermissionError } from '../labels';
import {
  ALL_ROLES,
  type AccountRoleFilter,
  type AccountSummary,
  type InvitedAccount,
} from '../types';
import { AccountsTable } from './AccountsTable';
import {
  AccountsEmptyState,
  AccountsPermissionState,
  AccountsTableSkeleton,
} from './AccountsStates';
import { AccountsToolbar } from './AccountsToolbar';
import { CreateAccountSheet } from './CreateAccountSheet';

/**
 * Administração de contas (frames `Admin · contas — lista`, `— nova conta` e
 * `— convite enviado`).
 *
 * Entrada: `?view=contas` (deep link) ou o item "Contas de acesso" do menu do
 * usuário. Quem decide se a lista pode ser lida é a API, não a tela: o papel
 * pode ter mudado depois do login, e um 403 aqui é a resposta legítima.
 */
export function AccountsScreen() {
  const { closeAccounts } = useAppView();
  const accountsQuery = useAccounts();
  const resendInvite = useResendInvite();
  const setAccountActive = useSetAccountActive();

  const [search, setSearch] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<AccountRoleFilter>(ALL_ROLES);
  const [isSheetOpen, setIsSheetOpen] = useState<boolean>(false);
  // Estado de sessão da tela: o alerta verde não sobrevive a um recarregamento.
  const [inviteNotice, setInviteNotice] = useState<{ accountId: string; email: string } | null>(
    null,
  );
  // Conta criada, e-mail não entregue: um aviso próprio, e não um "enviado".
  const [deliveryFailure, setDeliveryFailure] = useState<{ email: string } | null>(null);

  const debouncedSearch = useDebounce(search);
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const filtered = useMemo(
    () => filterAccounts(accounts, debouncedSearch, roleFilter),
    [accounts, debouncedSearch, roleFilter],
  );

  const permissionDenied = isPermissionError(accountsQuery.error);
  const summary = formatAccountsSummary(filtered.length, countPendingInvites(filtered));

  // `variables` só existe enquanto a mutação está em voo — daí a leitura
  // acontecer dentro do teste de `isPending`.
  const pendingId = resendInvite.isPending
    ? resendInvite.variables.id
    : setAccountActive.isPending
      ? setAccountActive.variables.account.id
      : null;

  const openSheet = useCallback((): void => {
    setIsSheetOpen(true);
  }, []);

  const closeSheet = useCallback((): void => {
    setIsSheetOpen(false);
  }, []);

  const handleResend = useCallback(
    (account: AccountSummary): void => {
      resendInvite.mutate(account);
    },
    [resendInvite],
  );

  const handleToggleActive = useCallback(
    (account: AccountSummary, isActive: boolean): void => {
      setAccountActive.mutate({ account, isActive });
    },
    [setAccountActive],
  );

  const handleCreated = useCallback((invited: InvitedAccount): void => {
    setInviteNotice({ accountId: invited.id, email: invited.email });
    setDeliveryFailure(null);
    setIsSheetOpen(false);
  }, []);

  const handleDeliveryFailed = useCallback((email: string): void => {
    // A conta existe: o alerta verde seria mentira, e o formulário aberto
    // convidaria a repetir o envio — que bateria em `EMAIL_ALREADY_EXISTS`.
    setInviteNotice(null);
    setDeliveryFailure({ email });
    setIsSheetOpen(false);
  }, []);

  const handleClearFilters = useCallback((): void => {
    setSearch('');
    setRoleFilter(ALL_ROLES);
  }, []);

  return (
    <AppShell>
      <section className="flex flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 w-fit"
              onClick={closeAccounts}
              aria-label="Voltar para a triagem"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Triagem
            </Button>
            <h1 className="text-xl font-semibold text-fg">Contas de acesso</h1>
            <p className="text-sm text-fg-muted">
              Quem entra na central, com qual papel e desde quando.
            </p>
          </div>

          <Button variant="primary" onClick={openSheet} disabled={permissionDenied}>
            <UserCheck className="h-4 w-4" aria-hidden="true" />+ Nova conta
          </Button>
        </header>

        {deliveryFailure === null ? null : (
          <div
            role="alert"
            data-testid="invite-delivery-failed-alert"
            className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-3 text-sm text-warning-text"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              A conta de {deliveryFailure.email} foi criada, mas o e-mail do convite não saiu.
              Use <strong>Reenviar convite</strong> na linha da conta para tentar de novo.
            </p>
          </div>
        )}

        {inviteNotice === null ? null : (
          <div
            role="status"
            data-testid="invite-sent-alert"
            className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-3 text-sm text-success-text"
          >
            <CircleCheckBig className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>
              Convite enviado para {inviteNotice.email}. A senha temporária expira em 24 horas e a
              conta fica pendente até o primeiro acesso.
            </p>
          </div>
        )}

        {permissionDenied ? (
          <AccountsPermissionState onBack={closeAccounts} />
        ) : (
          <>
            <AccountsToolbar
              search={search}
              roleFilter={roleFilter}
              summary={summary}
              onSearchChange={setSearch}
              onRoleFilterChange={setRoleFilter}
            />

            {accountsQuery.isPending ? <AccountsTableSkeleton /> : null}

            {accountsQuery.isError ? (
              <ErrorState
                variant="recoverable"
                title="Não foi possível carregar as contas"
                error={accountsQuery.error}
                failureCount={accountsQuery.failureCount}
                isRetrying={accountsQuery.isFetching}
                onRetry={() => {
                  void accountsQuery.refetch();
                }}
              />
            ) : null}

            {accountsQuery.isSuccess && accounts.length === 0 ? (
              <AccountsEmptyState
                filtered={false}
                onCreate={openSheet}
                onClearFilters={handleClearFilters}
              />
            ) : null}

            {accountsQuery.isSuccess && accounts.length > 0 && filtered.length === 0 ? (
              <AccountsEmptyState
                filtered
                onCreate={openSheet}
                onClearFilters={handleClearFilters}
              />
            ) : null}

            {accountsQuery.isSuccess && filtered.length > 0 ? (
              <AccountsTable
                accounts={filtered}
                highlightId={inviteNotice?.accountId ?? null}
                pendingId={pendingId}
                onResend={handleResend}
                onToggleActive={handleToggleActive}
              />
            ) : null}
          </>
        )}
      </section>

      <CreateAccountSheet
        open={isSheetOpen}
        onClose={closeSheet}
        onCreated={handleCreated}
        onDeliveryFailed={handleDeliveryFailed}
      />
    </AppShell>
  );
}
