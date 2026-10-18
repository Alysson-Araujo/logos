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
 *
 * **Abaixo de 768 px a linha vira bloco.** `flex-col` empilha as células na
 * ordem em que já estão no DOM, então a leitura continua a mesma; a moldura
 * passa a vir da linha, e não do card que envolve a tabela.
 *
 * A moldura no celular usa `ring` (sombra) e não `border`: a linha já tem
 * `border-b`, e duas utilidades de borda disputando o mesmo lado resolvem pela
 * ordem do CSS gerado — um resultado que muda sem ninguém mexer no componente.
 * `max-md:border-b-0` desfaz a borda da mesa, e o `ring` desenha a moldura.
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
      className={cn(
        'border-b border-border last:border-b-0',
        'max-md:flex max-md:flex-col max-md:gap-1.5 max-md:rounded-md max-md:border-b-0',
        'max-md:bg-surface max-md:p-4 max-md:shadow-e1 max-md:ring-1 max-md:ring-border',
        highlighted && 'bg-accent-soft',
      )}
      data-state={situation}
    >
      <td className="px-4 py-3 max-md:px-0 max-md:py-0">
        <p className="truncate text-sm font-medium text-fg">{account.name}</p>
        <p className="truncate text-2xs text-fg-muted">{account.email}</p>
      </td>
      <td className="px-4 py-3 max-md:px-0 max-md:py-0">
        <Badge tone="neutral">{ACCOUNT_ROLE_LABELS[account.role]}</Badge>
      </td>
      <td className="px-4 py-3 max-md:px-0 max-md:py-0">
        <Badge tone={ACCOUNT_SITUATION_TONES[situation]}>
          {ACCOUNT_SITUATION_LABELS[situation]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-2xs text-fg-muted max-md:px-0 max-md:py-0 max-md:before:content-['Último_acesso:']">
        {/* O rótulo vem do `::before` e não de um `<span>`: o cabeçalho some no
            celular, mas o texto da célula precisa continuar sendo só o valor —
            um teste que compare o conteúdo exato da célula não deve quebrar
            porque a tela ficou estreita. */}
        <span title={formatLastLoginAbsolute(account.lastLoginAt)}>{lastLogin}</span>
      </td>
      <td className="px-4 py-3 text-right max-md:px-0 max-md:py-0 max-md:text-left">
        {account.invitePending ? (
          <Button
            variant="ghost"
            size="sm"
            className="max-md:min-h-11 max-md:w-full"
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
            className="max-md:min-h-11 max-md:w-full"
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
