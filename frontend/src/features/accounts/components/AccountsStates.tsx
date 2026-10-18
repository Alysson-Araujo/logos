import { ArrowLeft, ShieldAlert, UserRoundPlus, UserRoundX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const SKELETON_ROWS = 4;

/**
 * Carregando: o esqueleto tem a forma da tabela (cabeçalho + 5 colunas), e não
 * um spinner — a tela não "pula" quando os dados chegam.
 */
export function AccountsTableSkeleton({ rows = SKELETON_ROWS }: { rows?: number }) {
  return (
    <div>
      <p role="status" className="sr-only">
        Carregando contas…
      </p>
      <div
        data-testid="accounts-skeleton"
        aria-hidden="true"
        className="overflow-hidden rounded-md border border-border bg-surface shadow-e1"
      >
        <div className="flex items-center gap-4 bg-surface-sunken px-4 py-2.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="ml-auto h-3 w-14" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-12" />
        </div>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-4 border-b border-border px-4 py-3">
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-52" />
            </div>
            <Skeleton className="h-4 w-20 rounded-full" />
            <Skeleton className="h-4 w-24 rounded-full" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export interface AccountsEmptyStateProps {
  /** `true` quando existem contas, mas nenhuma casa com os filtros. */
  filtered: boolean;
  onCreate: () => void;
  onClearFilters: () => void;
}

export function AccountsEmptyState({
  filtered,
  onCreate,
  onClearFilters,
}: AccountsEmptyStateProps) {
  if (filtered) {
    return (
      <div
        data-testid="accounts-empty-filtered"
        className="flex flex-col items-center gap-3 rounded-md border border-border bg-surface px-6 py-12 text-center shadow-e1"
      >
        <UserRoundX className="h-8 w-8 text-fg-subtle" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-fg">Nenhuma conta para os filtros aplicados</p>
          <p className="text-xs text-fg-muted">
            Ajuste a busca ou o papel para ver as outras contas da central.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onClearFilters}>
          Limpar filtros
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="accounts-empty-initial"
      className="flex flex-col items-center gap-3 rounded-md border border-border bg-surface px-6 py-12 text-center shadow-e1"
    >
      <UserRoundPlus className="h-8 w-8 text-fg-subtle" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-fg">Nenhuma conta cadastrada ainda</p>
        <p className="text-xs text-fg-muted">
          A primeira pessoa entra por convite: o e-mail leva a senha temporária e ela define a
          definitiva no primeiro acesso.
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={onCreate}>
        Criar a primeira conta
      </Button>
    </div>
  );
}

/**
 * Sem permissão (403).
 *
 * Deliberadamente **sem** "Tentar novamente": o papel de quem está logado não
 * muda por insistir, e repetir a consulta só produziria o mesmo 403.
 */
export function AccountsPermissionState({ onBack }: { onBack: () => void }) {
  return (
    <div
      data-testid="accounts-permission"
      role="alert"
      className="flex flex-col items-center gap-3 rounded-md border border-border bg-surface px-6 py-12 text-center shadow-e1"
    >
      <ShieldAlert className="h-8 w-8 text-warning" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-fg">Sua conta não administra outras contas</p>
        <p className="text-xs text-fg-muted">
          A administração de contas exige o papel ADMIN. A lista não será consultada de novo — peça
          o acesso a um administrador.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={onBack}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Voltar para a triagem
      </Button>
    </div>
  );
}
