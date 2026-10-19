import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/http';

import {
  accountSituation,
  describeAccountsError,
  describeCreateAccountError,
  formatAccountsSummary,
  formatLastLogin,
  isPermissionError,
} from './labels';
import type { AccountSummary } from './types';

function apiError(status: number, code: string, details: unknown = null): ApiError {
  return new ApiError({ status, code, message: 'mensagem interna da API', details });
}

function account(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 'conta-1',
    name: 'Joana Prado',
    email: 'joana.prado@demo.example.com',
    role: 'REPORTER',
    isActive: true,
    invitePending: false,
    lastLoginAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function todayAt(hour: number, minute: number): Date {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date;
}

function daysAgoAt(days: number, hour: number, minute: number): Date {
  const date = todayAt(hour, minute);
  date.setDate(date.getDate() - days);
  return date;
}

describe('formatLastLogin', () => {
  it('escreve o acesso de hoje e de ontem com a hora', () => {
    expect(formatLastLogin(todayAt(9, 12).toISOString())).toBe('hoje, 09:12');
    expect(formatLastLogin(daysAgoAt(1, 17, 40).toISOString())).toBe('ontem, 17:40');
  });

  it('conta os dias corridos dos acessos mais antigos', () => {
    expect(formatLastLogin(daysAgoAt(12, 8, 0).toISOString())).toBe('12 dias atrás');
    expect(formatLastLogin(daysAgoAt(2, 23, 59).toISOString())).toBe('2 dias atrás');
  });

  it('mostra "—" para quem nunca entrou e data cheia para o futuro', () => {
    expect(formatLastLogin(null)).toBe('—');
    expect(formatLastLogin('não é data')).toBe('—');

    const future = new Date();
    future.setDate(future.getDate() + 3);
    expect(formatLastLogin(future.toISOString())).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe('formatAccountsSummary', () => {
  it('flexiona conta e convite', () => {
    expect(formatAccountsSummary(4, 2)).toBe('4 contas · 2 convites pendentes');
    expect(formatAccountsSummary(1, 1)).toBe('1 conta · 1 convite pendente');
    expect(formatAccountsSummary(0, 0)).toBe('0 contas · 0 convites pendentes');
    expect(formatAccountsSummary(2, 0)).toBe('2 contas · 0 convites pendentes');
  });
});

describe('accountSituation', () => {
  it('dá prioridade ao convite pendente sobre a conta desativada', () => {
    expect(accountSituation(account({ invitePending: true, isActive: false }))).toBe('pending');
    expect(accountSituation(account({ invitePending: true, isActive: true }))).toBe('pending');
    expect(accountSituation(account({ isActive: true }))).toBe('active');
    expect(accountSituation(account({ isActive: false }))).toBe('inactive');
  });
});

describe('describeCreateAccountError', () => {
  it('leva o 409 para o campo de e-mail', () => {
    expect(
      describeCreateAccountError(apiError(409, 'EMAIL_ALREADY_EXISTS', { email: 'x@y.com' })),
    ).toEqual({ field: 'email', message: 'Já existe uma conta com este e-mail.' });
    // O `409 CONFLICT` genérico cai no mesmo lugar.
    expect(describeCreateAccountError(apiError(409, 'CONFLICT')).field).toBe('email');
  });

  it('usa o campo apontado pelo 422 da API', () => {
    const error = apiError(422, 'VALIDATION_ERROR', {
      validationErrors: [{ loc: ['body', 'role'], msg: 'Informe um papel válido.' }],
    });

    expect(describeCreateAccountError(error)).toEqual({
      field: 'role',
      message: 'Informe um papel válido.',
    });
  });

  it('sem campo apontado, devolve aviso de topo', () => {
    const error = apiError(422, 'VALIDATION_ERROR', { validationErrors: [] });

    expect(describeCreateAccountError(error)).toEqual({
      field: null,
      message: 'Revise os dados enviados.',
    });
    expect(describeCreateAccountError(apiError(403, 'INSUFFICIENT_ROLE')).field).toBeNull();
    expect(describeCreateAccountError(new Error('boom')).field).toBeNull();
  });
});

describe('isPermissionError', () => {
  it('reconhece o 403 de papel e ignora o de senha temporária', () => {
    expect(isPermissionError(apiError(403, 'INSUFFICIENT_ROLE'))).toBe(true);
    expect(isPermissionError(apiError(403, 'PASSWORD_CHANGE_REQUIRED'))).toBe(false);
    expect(isPermissionError(apiError(401, 'UNAUTHENTICATED'))).toBe(false);
    expect(isPermissionError(new Error('boom'))).toBe(false);
  });
});

describe('describeAccountsError', () => {
  it('traduz transporte e mantém as mensagens de domínio da API', () => {
    expect(
      describeAccountsError(
        new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'x', kind: 'network' }),
      ),
    ).toMatch(/Sem conexão/);
    expect(describeAccountsError(apiError(409, 'CANNOT_DEACTIVATE_SELF'))).toBe(
      'Você não pode desativar a própria conta.',
    );
    expect(describeAccountsError(new Error('boom'))).not.toBe('');
  });
});
