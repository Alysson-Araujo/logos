import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildIncidentSearch,
  countActiveFilters,
  parseIncidentFilters,
  useIncidentFilters,
} from './useIncidentFilters';
import { DEFAULT_INCIDENT_FILTERS } from '../types';

describe('useIncidentFilters — serialização', () => {
  it('serializa os filtros na query string (CSV nos campos multi-valor)', () => {
    const search = buildIncidentSearch({
      statuses: ['ABERTO', 'EM_INVESTIGACAO'],
      criticalities: ['ALTA'],
      categories: ['BLOQUEIO_DE_PISTA'],
      search: 'BR-116',
      sort: 'created_desc',
    });
    const params = new URLSearchParams(search);

    expect(params.get('status')).toBe('ABERTO,EM_INVESTIGACAO');
    expect(params.get('criticality')).toBe('ALTA');
    expect(params.get('category')).toBe('BLOQUEIO_DE_PISTA');
    expect(params.get('search')).toBe('BR-116');
    expect(params.get('sort')).toBe('created_desc');
  });

  it('omite a ordenação padrão e a busca vazia para manter a URL curta', () => {
    expect(buildIncidentSearch(DEFAULT_INCIDENT_FILTERS)).toBe('');
  });

  it('desserializa ignorando valores fora do contrato e normalizando caixa', () => {
    const filters = parseIncidentFilters(
      '?status=ABERTO,XPTO,aberto&criticality=alta&category=PROBLEMA_MECANICO&search=Neblina&sort=created_asc',
    );

    expect(filters.statuses).toEqual(['ABERTO']);
    expect(filters.criticalities).toEqual(['ALTA']);
    expect(filters.categories).toEqual(['PROBLEMA_MECANICO']);
    expect(filters.search).toBe('Neblina');
    expect(filters.sort).toBe('created_asc');
  });

  it('cai na ordenação padrão quando o parâmetro é inválido', () => {
    expect(parseIncidentFilters('?sort=banana').sort).toBe('priority_desc');
  });

  it('conta os filtros ativos (ordenação não conta)', () => {
    expect(
      countActiveFilters({
        statuses: ['ABERTO'],
        criticalities: ['ALTA', 'BAIXA'],
        categories: [],
        search: 'BR-101',
        sort: 'created_asc',
      }),
    ).toBe(4);
  });
});

describe('useIncidentFilters — estado na URL', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('escreve na URL, lê de volta e limpa (link compartilhável)', () => {
    const { result } = renderHook(() => useIncidentFilters());

    expect(result.current.filters).toEqual(DEFAULT_INCIDENT_FILTERS);

    act(() => {
      result.current.patchFilters({ criticalities: ['ALTA'], search: 'BR-116' });
    });

    expect(window.location.search).toContain('criticality=ALTA');
    expect(window.location.search).toContain('search=BR-116');
    expect(result.current.filters.criticalities).toEqual(['ALTA']);
    expect(result.current.activeFilterCount).toBe(2);

    act(() => {
      result.current.toggleStatus('ABERTO');
    });
    expect(result.current.filters.statuses).toEqual(['ABERTO']);
    expect(window.location.search).toContain('status=ABERTO');

    act(() => {
      result.current.toggleStatus('ABERTO');
    });
    expect(result.current.filters.statuses).toEqual([]);

    act(() => {
      result.current.clearFilters();
    });
    expect(window.location.search).toBe('');
    expect(result.current.filters).toEqual(DEFAULT_INCIDENT_FILTERS);
  });

  it('hidrata os filtros a partir de uma URL já existente', () => {
    window.history.replaceState(null, '', '/?criticality=ALTA,BAIXA&category=PROBLEMA_MECANICO');

    const { result } = renderHook(() => useIncidentFilters());

    expect(result.current.filters.criticalities).toEqual(['ALTA', 'BAIXA']);
    expect(result.current.filters.categories).toEqual(['PROBLEMA_MECANICO']);
    expect(result.current.activeFilterCount).toBe(3);
  });
});
