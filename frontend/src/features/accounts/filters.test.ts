import { describe, expect, it } from 'vitest';

import { createAccountFixtures } from '@/test/factories';

import { countPendingInvites, filterAccounts } from './filters';
import { ALL_ROLES } from './types';

const accounts = createAccountFixtures();

describe('filterAccounts', () => {
  it('sem filtro devolve a lista inteira', () => {
    expect(filterAccounts(accounts, '', ALL_ROLES)).toHaveLength(4);
    expect(filterAccounts(accounts, '   ', ALL_ROLES)).toHaveLength(4);
  });

  it('busca por nome e por e-mail, ignorando caixa e espaços', () => {
    expect(filterAccounts(accounts, 'joana', ALL_ROLES).map((item) => item.id)).toEqual([
      'conta-joana',
    ]);
    expect(filterAccounts(accounts, '  JOANA  ', ALL_ROLES).map((item) => item.id)).toEqual([
      'conta-joana',
    ]);
    expect(filterAccounts(accounts, 'bruno.tavares@', ALL_ROLES).map((item) => item.id)).toEqual([
      'conta-bruno',
    ]);
    expect(filterAccounts(accounts, 'AUTOU.COM.BR', ALL_ROLES)).toHaveLength(4);
    expect(filterAccounts(accounts, 'ninguém', ALL_ROLES)).toEqual([]);
  });

  it('combina papel e busca', () => {
    expect(filterAccounts(accounts, '', 'ANALYST').map((item) => item.id)).toEqual([
      'conta-bruno',
      'conta-carla',
    ]);
    expect(filterAccounts(accounts, 'carla', 'ANALYST').map((item) => item.id)).toEqual([
      'conta-carla',
    ]);
    expect(filterAccounts(accounts, 'carla', 'ADMIN')).toEqual([]);
  });

  it('conta os convites pendentes', () => {
    expect(countPendingInvites(accounts)).toBe(1);
    expect(countPendingInvites([])).toBe(0);
  });
});
