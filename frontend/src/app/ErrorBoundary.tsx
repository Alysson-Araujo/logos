import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { copyTextToClipboard } from '@/lib/utils';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Última linha de defesa: um erro de render nunca deve deixar a tela em branco
 * (a tela de missão crítica precisa dizer o que aconteceu).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Erro não tratado na interface do Logos.', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
        <h1 className="text-lg font-semibold text-fg">A interface encontrou um erro inesperado</h1>
        <p className="max-w-md text-sm text-fg-muted">
          Nada foi perdido no servidor. Recarregue a página para voltar à triagem.
        </p>
        <pre className="max-h-40 max-w-xl overflow-auto rounded-sm bg-surface-sunken p-3 text-2xs text-fg-muted">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              window.location.reload();
            }}
          >
            Recarregar
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void copyTextToClipboard(error.stack ?? error.message);
            }}
          >
            Copiar detalhes técnicos
          </Button>
        </div>
      </div>
    );
  }
}
