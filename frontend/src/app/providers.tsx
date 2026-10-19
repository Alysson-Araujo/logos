import { QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient } from '@/lib/queryClient';

import { ErrorBoundary } from './ErrorBoundary';
import { MockApiBanner } from './MockApiBanner';

/** Providers globais: cache de servidor, tooltips, toasts e captura de erros. */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={250} skipDelayDuration={300}>
          <MockApiBanner />
          {children}
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
