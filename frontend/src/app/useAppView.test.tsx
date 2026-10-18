import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from '@/features/auth/useAuthStore';
import { createQueryClient } from '@/lib/queryClient';
import { createAdminSession } from '@/test/auth';

import { RootScreen } from './RootScreen';
import { parseAppView, useAppView, withAppView } from './useAppView';

describe('view na URL', () => {
  it('só `?view=contas` abre a administração', () => {
    expect(parseAppView('?view=contas')).toBe('contas');
    expect(parseAppView('')).toBe('triagem');
    expect(parseAppView('?view=triagem')).toBe('triagem');
    expect(parseAppView('?view=qualquer-outra-coisa')).toBe('triagem');
  });

  it('preserva os filtros da triagem ao entrar e ao sair', () => {
    expect(withAppView('?status=ABERTO&search=BR-116', 'contas')).toBe(
      '?status=ABERTO&search=BR-116&view=contas',
    );
    expect(withAppView('?status=ABERTO&view=contas', 'triagem')).toBe('?status=ABERTO');
    expect(withAppView('', 'triagem')).toBe('');
  });
});

describe('useAppView', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('escreve o deep link e volta para a triagem', () => {
    const { result } = renderHook(() => useAppView());

    expect(result.current.view).toBe('triagem');

    act(() => {
      result.current.openAccounts();
    });
    expect(result.current.view).toBe('contas');
    expect(window.location.search).toBe('?view=contas');

    act(() => {
      result.current.closeAccounts();
    });
    expect(result.current.view).toBe('triagem');
    expect(window.location.search).toBe('');
  });

  it('hidrata a tela a partir de uma URL já existente', () => {
    window.history.replaceState(null, '', '/?view=contas');

    const { result } = renderHook(() => useAppView());

    expect(result.current.view).toBe('contas');
  });
});

describe('RootScreen', () => {
  it('monta a administração de contas quando a URL traz ?view=contas', async () => {
    window.history.replaceState(null, '', '/?view=contas');
    useAuthStore.setState({ session: createAdminSession(), notice: null, pendingPassword: null });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <RootScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Contas de acesso' })).toBeInTheDocument();
    // A lista vem da API simulada (as quatro contas do seed).
    expect(await screen.findByText('marina@autou.com.br')).toBeInTheDocument();
  });
});
