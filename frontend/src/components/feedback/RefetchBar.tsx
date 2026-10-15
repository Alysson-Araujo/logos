export interface RefetchBarProps {
  isFetching: boolean;
  isInitialLoading: boolean;
}

/** Estado `refetching`: barra fina no topo, conteúdo continua visível. */
export function RefetchBar({ isFetching, isInitialLoading }: RefetchBarProps) {
  if (!isFetching || isInitialLoading) return null;

  return (
    <div>
      <span className="sr-only" role="status" aria-live="polite">
        Atualizando a lista de incidentes.
      </span>
      <div aria-hidden="true" className="relative h-0.5 w-full overflow-hidden bg-surface-sunken">
        <span className="logos-indeterminate absolute inset-y-0 left-0 w-1/4 bg-accent" />
      </div>
    </div>
  );
}
