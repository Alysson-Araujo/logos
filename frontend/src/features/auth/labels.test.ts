import { describe, expect, it } from 'vitest';

import { ApiError, type ApiErrorKind } from '@/lib/http';

import {
  describeLoginError,
  formatSessionLabel,
  initialsFromName,
  LOGIN_INVALID_CREDENTIALS,
  LOGIN_SESSION_EXPIRED,
} from './labels';
import type { AuthUser } from './types';

function buildError(status: number, code: string, kind: ApiErrorKind = 'http'): ApiError {
  return new ApiError({ status, code, message: 'mensagem interna do servidor', kind });
}

function buildUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-ana',
    email: 'ana@demo.example.com',
    name: 'Ana Paula Ribeiro',
    role: 'ANALYST',
    lastLoginAt: null,
    ...overrides,
  };
}

describe('initialsFromName', () => {
  it('usa a primeira e a última palavra', () => {
    expect(initialsFromName('Ana Paula Ribeiro')).toBe('AR');
    expect(initialsFromName('Carlos Eduardo Lima')).toBe('CL');
    expect(initialsFromName('Alysson Araújo')).toBe('AA');
  });

  it('funciona com nome de uma palavra só', () => {
    expect(initialsFromName('Marina')).toBe('M');
  });

  it('ignora espaços extras e não devolve vazio', () => {
    expect(initialsFromName('  Bruno   Tavares  ')).toBe('BT');
    expect(initialsFromName('   ')).toBe('?');
  });
});

describe('formatSessionLabel', () => {
  it('monta o rótulo do header no vocabulário do Figma', () => {
    expect(formatSessionLabel(buildUser())).toBe('Ana Paula Ribeiro · analista');
  });

  it('traduz os três papéis', () => {
    expect(formatSessionLabel(buildUser({ role: 'REPORTER' }))).toContain('repórter');
    expect(formatSessionLabel(buildUser({ role: 'ADMIN' }))).toContain('administrador');
  });
});

describe('describeLoginError', () => {
  it('usa o texto exato do frame de erro para credencial inválida', () => {
    expect(describeLoginError(buildError(401, 'INVALID_CREDENTIALS'))).toBe(
      LOGIN_INVALID_CREDENTIALS,
    );
  });

  it('trata sessão expirada como mensagem própria', () => {
    expect(describeLoginError(buildError(401, 'UNAUTHENTICATED'))).toBe(LOGIN_SESSION_EXPIRED);
    expect(describeLoginError(buildError(401, 'TOKEN_EXPIRED'))).toBe(LOGIN_SESSION_EXPIRED);
  });

  it('separa falha de transporte de credencial errada', () => {
    expect(describeLoginError(buildError(0, 'REQUEST_TIMEOUT', 'timeout'))).toMatch(/acordando/);
    expect(describeLoginError(buildError(0, 'NETWORK_ERROR', 'network'))).toMatch(/Sem conexão/);
    expect(describeLoginError(buildError(0, 'OFFLINE', 'offline'))).toMatch(/Sem conexão/);
  });

  it('cobre limite de taxa, falha do servidor e contrato quebrado', () => {
    expect(describeLoginError(buildError(429, 'RATE_LIMITED'))).toMatch(/Muitas tentativas/);
    expect(describeLoginError(buildError(503, 'SERVICE_UNAVAILABLE'))).toMatch(/falhou/);
    expect(describeLoginError(buildError(0, 'CONTRACT_ERROR', 'contract'))).toMatch(/falhou/);
  });

  it('tem resposta para o que não é erro da API', () => {
    expect(describeLoginError(new Error('boom'))).toMatch(/Não foi possível entrar/);
    expect(describeLoginError(null)).toMatch(/Não foi possível entrar/);
  });

  it('não repassa a mensagem do servidor para a tela', () => {
    expect(describeLoginError(buildError(401, 'INVALID_CREDENTIALS'))).not.toContain(
      'mensagem interna',
    );
  });
});
