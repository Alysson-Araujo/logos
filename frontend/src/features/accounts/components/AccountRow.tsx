import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  ACCOUNT_ROLE_LABELS,
  ACCOUNT_SITUATION_LABELS,
  ACCOUNT_SITUATION_TONES,
  accountSituation,
  formatLastLogin,
  formatLastLoginAbsolute,
} from '../labels';
import type { AccountSummary } from '../types';

export interface AccountRowProps {
  account: AccountSummary;
  /** Linha recém-criada: fica destacada em `accent-soft`. */
  highlighted?: boolean;
  /** Ação desta linha em andamento (desabilita só ela). */
  isActionPending?: boolean;
  onResend: (account: AccountSummary) => void;
  onToggleActive: (account: AccountSummary, isActive: boolean) => void;
}

/**
 * Linha da tabela de contas (frame `Admin · contas — lista`).
 *
 * Altura ~63 px: 12 px de padding vertical + nome (20) + e-mail (16). A coluna
 * "Pessoa" é a única elástica; as outras têm largura fixa no `colgroup` da
 * tabela.
 */
export function AccountRow({
  account,
  highlighted = false,
  isActionPending = false,
  onResend,
  onToggleActive,
}: AccountRowProps) {
  const situation = accountSituation(account);
  const lastLogin = formatLastLogin(account.lastLoginAt);

  return (
    <tr
      className={cn('border-b border-border last:border-b-0', highlighted && 'bg-accent-soft')}
      data-state={situation}
    >
      <td className="px-4 py-3">
        <p className="truncate text-sm font-medium text-fg">{account.name}</p>
        <p className="truncate text-2xs text-fg-muted">{account.email}</p>
      </td>
      <td className="px-4 py-3">
        <Badge tone="neutral">{ACCOUNT_ROLE_LABELS[account.role]}</Badge>
      </td>
      <td className="px-4 py-3">
        <Badge tone={ACCOUNT_SITUATION_TONES[situation]}>
          {ACCOUNT_SITUATION_LABELS[situation]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-2xs text-fg-muted">
        <span title={formatLastLoginAbsolute(account.lastLoginAt)}>{lastLogin}</span>
      </td>
      <td className="px-4 py-3 text-right">
        {account.invitePending ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={isActionPending}
            onClick={() => {
              onResend(account);
            }}
            aria-label={`Reenviar o convite de ${account.name}`}
          >
            Reenviar
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={isActionPending}
            onClick={() => {
              onToggleActive(account, !account.isActive);
            }}
            aria-label={`${account.isActive ? 'Desativar' : 'Reativar'} a conta de ${account.name}`}
          >
            {account.isActive ? 'Desativar' : 'Reativar'}
          </Button>
        )}
      </td>
    </tr>
  );
}
