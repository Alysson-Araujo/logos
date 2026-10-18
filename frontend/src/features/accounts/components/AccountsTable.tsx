import { AccountRow } from './AccountRow';
import type { AccountSummary } from '../types';

export interface AccountsTableProps {
  accounts: readonly AccountSummary[];
  /** Conta recém-criada, destacada até a lista ser recarregada. */
  highlightId?: string | null;
  /** Id da conta com ação em andamento. */
  pendingId?: string | null;
  onResend: (account: AccountSummary) => void;
  onToggleActive: (account: AccountSummary, isActive: boolean) => void;
}

const COLUMNS = [
  { label: 'Pessoa', width: undefined },
  { label: 'Papel', width: 140 },
  { label: 'Situação', width: 170 },
  { label: 'Último acesso', width: 160 },
  { label: 'Ações', width: 140 },
] as const;

/**
 * Tabela de contas (frame `Admin · contas — lista`).
 *
 * Card branco com `radius-md` e borda, cabeçalho em `surface-sunken` e rótulos
 * em caixa alta via CSS — o texto no DOM continua legível para leitor de tela.
 *
 * **Uma tabela só, duas leituras.** Abaixo de 768 px (`md`) o cabeçalho some e
 * cada linha vira um bloco com moldura própria: cinco colunas não cabem em
 * 360 px sem espremer nome, papel e situação até ninguém ler.
 *
 * **Por que não renderizar cartões no celular e tabela na mesa.** As duas
 * versões ficariam no DOM ao mesmo tempo, e toda consulta por texto passaria a
 * encontrar dois elementos iguais — o custo apareceria em cada teste futuro,
 * que precisaria saber escopar. Aqui o DOM é um só; quem muda é o `display`.
 *
 * A semântica sobrevive à mudança de layout: `<tr>` continua sendo `row` e
 * `<th>` continua sendo `columnheader` em qualquer largura, então leitor de
 * tela e testes enxergam a mesma estrutura.
 */
export function AccountsTable({
  accounts,
  highlightId = null,
  pendingId = null,
  onResend,
  onToggleActive,
}: AccountsTableProps) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface shadow-e1 max-md:overflow-visible max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
      <table className="w-full table-fixed border-collapse text-left max-md:block">
        <caption className="sr-only">
          Contas de acesso da central, com papel, situação e último acesso
        </caption>
        <colgroup className="max-md:hidden">
          {COLUMNS.map((column) => (
            <col
              key={column.label}
              style={column.width === undefined ? undefined : { width: column.width }}
            />
          ))}
        </colgroup>
        <thead className="bg-surface-sunken max-md:hidden">
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.label}
                scope="col"
                className="px-4 py-2.5 text-2xs font-semibold uppercase tracking-[0.025em] text-fg-muted"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-md:flex max-md:flex-col max-md:gap-3">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              highlighted={account.id === highlightId}
              isActionPending={account.id === pendingId}
              onResend={onResend}
              onToggleActive={onToggleActive}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
