import { describe, expect, it } from 'vitest';

import {
  PRIORITY_TIER_PRESENTATION,
  PRIORITY_TIER_THRESHOLDS,
  priorityTier,
  type PriorityTier,
} from './priority';

/**
 * Fronteiras das faixas de prioridade.
 *
 * O teste é sobre os **limites**, e não sobre valores no meio: um erro de `>`
 * contra `>=` só aparece exatamente na fronteira, e é o tipo de defeito que
 * passa despercebido por um teste que use 1.500 e 300.
 */

const TIERS: PriorityTier[] = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'];

describe('priorityTier', () => {
  it('classifica exatamente na fronteira como a faixa de cima', () => {
    // `>=`, e não `>`: um score de 1.100 é CRÍTICA, não ALTA.
    expect(priorityTier(1100)).toBe('CRITICA');
    expect(priorityTier(900)).toBe('ALTA');
    expect(priorityTier(700)).toBe('MEDIA');
  });

  it('classifica um ponto abaixo da fronteira como a faixa de baixo', () => {
    expect(priorityTier(1099)).toBe('ALTA');
    expect(priorityTier(899)).toBe('MEDIA');
    expect(priorityTier(699)).toBe('BAIXA');
  });

  it('cobre os extremos da base real', () => {
    // Mínimo e máximo observados nos 120 incidentes (min=378, máx=1400).
    expect(priorityTier(378)).toBe('BAIXA');
    expect(priorityTier(1400)).toBe('CRITICA');
  });

  it('não estoura com valores fora da faixa possível', () => {
    // Um `NaN` que chegue à tela não pode derrubar a lista.
    expect(priorityTier(Number.NaN)).toBe('BAIXA');
    expect(priorityTier(-1)).toBe('BAIXA');
    expect(priorityTier(Number.POSITIVE_INFINITY)).toBe('CRITICA');
  });

  it('reparte a distribuição real em blocos utilizáveis', () => {
    // Quintis medidos na base (out/2026). Se uma faixa concentrasse mais da
    // metade da fila, ela não ajudaria a triar — foi por isso que as fronteiras
    // não ficaram em 1000/700/400.
    const quintis = [740, 780, 910, 1030, 1160];
    const faixas = quintis.map((score) => priorityTier(score));

    expect(new Set(faixas).size).toBeGreaterThanOrEqual(3);
  });

  it('as fronteiras estão em ordem decrescente e terminam em -Infinity', () => {
    const minimos = PRIORITY_TIER_THRESHOLDS.map((faixa) => faixa.min);

    expect(minimos).toEqual([...minimos].sort((a, b) => b - a));
    expect(minimos.at(-1)).toBe(Number.NEGATIVE_INFINITY);
    expect(PRIORITY_TIER_THRESHOLDS.map((faixa) => faixa.tier)).toEqual(TIERS);
  });
});

describe('PRIORITY_TIER_PRESENTATION', () => {
  it('dá os três canais a toda faixa', () => {
    for (const tier of TIERS) {
      const presentation = PRIORITY_TIER_PRESENTATION[tier];

      // Cor sozinha falha para quem não a distingue (WCAG 1.4.1): forma e
      // rótulo precisam carregar a mesma informação.
      expect(presentation.icon).not.toBe('');
      expect(presentation.label).not.toBe('');
      expect(presentation.description).not.toBe('');
      expect(presentation.borderClass).toContain('border-l');
    }
  });

  it('usa uma cor de borda distinta por faixa', () => {
    const bordas = TIERS.map((tier) => PRIORITY_TIER_PRESENTATION[tier].borderClass);

    expect(new Set(bordas).size).toBe(TIERS.length);
  });

  it('não reusa os tokens de criticidade', () => {
    // A criticidade é um campo que o repórter escolhe; a prioridade é o cálculo
    // que ordena a fila. Se as duas dividissem a mesma cor, a borda da linha e o
    // selo diriam a mesma coisa com significados diferentes.
    for (const tier of TIERS) {
      const { borderClass, softClass, textClass } = PRIORITY_TIER_PRESENTATION[tier];

      expect(borderClass).not.toContain('crit-');
      expect(softClass).not.toContain('crit-');
      expect(textClass).not.toContain('crit-');
    }
  });
});
