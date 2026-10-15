import { SearchX, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';

export type EmptyStateVariant = 'initial' | 'filtered';

export interface EmptyStateProps {
  variant: EmptyStateVariant;
  /** Filtros ativos descritos em PT-BR (usado no vazio filtrado). */
  filterDescriptions?: string[];
  onCreate?: () => void;
  onClearFilters?: () => void;
}

/**
 * Dois vazios diferentes (seção 8.2):
 *  - `emptyInitial`: nada cadastrado → boa notícia + CTA de criar;
 *  - `emptyFiltered`: o filtro não achou nada → botão de limpar filtros.
 */
export function EmptyState({
  variant,
  filterDescriptions = [],
  onCreate,
  onClearFilters,
}: EmptyStateProps) {
  if (variant === 'filtered') {
    const description =
      filterDescriptions.length > 0 ? filterDescriptions.join(' · ') : 'os filtros aplicados';

    return (
      <div
        data-testid="empty-state-filtered"
        className="flex flex-col items-center gap-3 px-6 py-12 text-center"
      >
        <SearchX className="h-8 w-8 text-fg-subtle" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-fg">Nenhum resultado para {description}</p>
          <p className="text-xs text-fg-muted">
            Ajuste os filtros ou limpe tudo para voltar à fila completa.
          </p>
        </div>
        {onClearFilters === undefined ? null : (
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            Limpar filtros
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="empty-state-initial"
      className="flex flex-col items-center gap-3 px-6 py-12 text-center"
    >
      <ShieldCheck className="h-8 w-8 text-success" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-semibold text-fg">Nenhum incidente registrado. Boa notícia.</p>
        <p className="text-xs text-fg-muted">
          Quando um novo evento chegar, ele aparece aqui já ordenado por prioridade.
        </p>
      </div>
      {onCreate === undefined ? null : (
        <Button variant="primary" size="sm" onClick={onCreate}>
          Criar incidente
        </Button>
      )}
    </div>
  );
}
