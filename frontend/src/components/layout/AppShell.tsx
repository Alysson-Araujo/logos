import type { ReactNode } from 'react';

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
      <footer className="border-t border-border bg-surface px-4 py-3">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-fg-subtle">
          <span>Logos · case fullstack AutoU · dados de demonstração</span>
          <span className="font-mono">j/k navega · Enter abre · / busca · t tema · Esc fecha</span>
          <a
            className="ml-auto underline-offset-4 hover:text-fg hover:underline"
            href="https://github.com/Alysson-Araujo/logos"
            target="_blank"
            rel="noreferrer noopener"
          >
            Repositório
          </a>
        </div>
      </footer>
    </div>
  );
}
