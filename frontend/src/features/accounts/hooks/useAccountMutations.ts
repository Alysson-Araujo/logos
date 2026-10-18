import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useToast } from '@/hooks/useToast';
import type { ApiError } from '@/lib/http';

import { createAccount, resendInvite, setAccountActive } from '../api';
import { describeAccountsError } from '../labels';
import type { AccountSummary, CreateAccountInput, InvitedAccount } from '../types';
import { accountQueryKeys } from './useAccounts';

/**
 * Mutações da administração de contas.
 *
 * Todas invalidam a lista: o estado que interessa (convite pendente, situação,
 * último acesso) é do servidor. Nada de atualização otimista aqui — criar conta
 * e reenviar convite são operações com efeito externo (e-mail), e mostrar
 * "pendente" antes da resposta seria mentira por um instante.
 */

export function useCreateAccount() {
  const queryClient = useQueryClient();

  return useMutation<InvitedAccount, ApiError, CreateAccountInput>({
    mutationFn: (input) => createAccount(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountQueryKeys.all });
    },
  });
}

/** O tipo de erro sai da inferência (`ApiError` em tempo de execução). */
export function useResendInvite() {
  const queryClient = useQueryClient();
  const pushToast = useToast();

  return useMutation({
    mutationFn: (account: AccountSummary) => resendInvite(account.id),
    onSuccess: (_data, account) => {
      pushToast({
        variant: 'success',
        title: 'Convite reenviado',
        description: `${account.email} · a senha temporária anterior deixou de valer`,
        durationMs: 4000,
      });
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Não foi possível reenviar o convite',
        description: describeAccountsError(error),
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: accountQueryKeys.all });
    },
  });
}

export interface SetAccountActiveVariables {
  account: AccountSummary;
  isActive: boolean;
}

export function useSetAccountActive() {
  const queryClient = useQueryClient();
  const pushToast = useToast();

  return useMutation<AccountSummary, ApiError, SetAccountActiveVariables>({
    mutationFn: (variables) => setAccountActive(variables.account.id, variables.isActive),
    onSuccess: (account) => {
      pushToast({
        variant: 'success',
        title: account.isActive ? 'Conta reativada' : 'Conta desativada',
        description: account.email,
      });
    },
    onError: (error) => {
      pushToast({
        variant: 'error',
        title: 'Não foi possível mudar a situação da conta',
        description: describeAccountsError(error),
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: accountQueryKeys.all });
    },
  });
}
