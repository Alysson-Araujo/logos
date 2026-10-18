import type { ReactNode } from 'react';

import { AppFooter } from './AppFooter';
import { Header } from './Header';

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <a
        href="#lista-de-incidentes"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[90] focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:shadow-e2"
      >
        Pular para a lista de incidentes
      </a>
      <Header />
      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-4">
        {children}
      </main>
      <AppFooter />
    </div>
  );
}
