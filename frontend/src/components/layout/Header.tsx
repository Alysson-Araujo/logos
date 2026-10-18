import { CircleHelp, LogOut, Radio, Truck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { formatSessionLabel, initialsFromName } from '@/features/auth/labels';
import { endSession } from '@/features/auth/session';
import { useAuthStore } from '@/features/auth/useAuthStore';
import { startTour } from '@/features/tour/useTour';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

import { ThemeToggle } from './ThemeToggle';

export function Header() {
  const isOnline = useOnlineStatus();
  // O nome sai da sessão: era literal no header até a autenticação existir.
  const user = useAuthStore((state) => state.session?.user ?? null);

  const handleSignOut = (): void => {
    endSession();
  };

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-4 px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Abrir o guia"
          title="Abrir o guia"
          onClick={startTour}
          className="-ml-2 shrink-0 text-fg-muted"
        >
          <CircleHelp className="h-4 w-4" aria-hidden="true" />
        </Button>

        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm bg-accent text-accent-fg"
          >
            <Truck className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p className="font-mono text-sm font-semibold tracking-tight text-fg">LOGOS</p>
            <p className="text-2xs text-fg-muted">Central de Resposta a Incidentes</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span
            data-tour="connection"
            className="hidden items-center gap-1.5 text-2xs font-medium text-fg-muted sm:inline-flex"
            role="status"
            aria-live="polite"
          >
            <Radio
              className={isOnline ? 'h-3.5 w-3.5 text-success' : 'h-3.5 w-3.5 text-warning'}
              aria-hidden="true"
            />
            {isOnline ? 'ao vivo' : 'sem conexão'}
          </span>
          <ThemeToggle />
          {user === null ? null : (
            <>
              <span className="hidden items-center gap-2 border-l border-border pl-3 text-2xs text-fg-muted md:inline-flex">
                <span
                  aria-hidden="true"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-surface-sunken font-semibold text-fg"
                >
                  {initialsFromName(user.name)}
                </span>
                {formatSessionLabel(user)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                title="Encerrar a sessão"
                className="text-fg-muted"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sair
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
