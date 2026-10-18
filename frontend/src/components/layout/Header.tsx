import { BookOpen, Radio, Truck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { startTour } from '@/features/tour/useTour';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

export function Header() {
  const isOnline = useOnlineStatus();

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-4 px-4 py-3">
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
          {/*
            "Guia" no grupo da direita, à esquerda do indicador "ao vivo": é o
            alvo do último passo do guia, daí o `data-tour="guide"`. O ícone
            fica à direita do texto (Figma, 1440 px).
          */}
          <Button
            variant="ghost"
            size="sm"
            data-tour="guide"
            aria-label="Abrir o guia"
            title="Abrir o guia"
            onClick={startTour}
            className="text-fg-muted"
          >
            Guia
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
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
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
