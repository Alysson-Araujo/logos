import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { INCIDENT_CRITICALITIES, type IncidentCriticality } from '../types';
import { CRITICALITY_PRESENTATION, CriticalityBadge } from './CriticalityBadge';

const EXPECTED = [
  {
    criticality: 'ALTA',
    icon: '▲',
    label: 'Alta',
    softClass: 'bg-crit-alta-soft',
    borderClass: 'border-l-4',
  },
  {
    criticality: 'MEDIA',
    icon: '◆',
    label: 'Média',
    softClass: 'bg-crit-media-soft',
    borderClass: 'border-l-[3px]',
  },
  {
    criticality: 'BAIXA',
    icon: '●',
    label: 'Baixa',
    softClass: 'bg-crit-baixa-soft',
    borderClass: 'border-l-2',
  },
] as const satisfies readonly {
  criticality: IncidentCriticality;
  icon: string;
  label: string;
  softClass: string;
  borderClass: string;
}[];

describe('CriticalityBadge', () => {
  it('entrega os três canais redundantes: cor, ícone e rótulo textual', () => {
    render(<CriticalityBadge criticality="ALTA" />);

    const badge = screen.getByTestId('criticality-badge');

    // Cor (token semântico) — nunca literal no componente.
    expect(badge).toHaveClass('bg-crit-alta-soft');
    expect(badge).toHaveClass('text-crit-alta-text');
    // Forma/ícone — legível em escala de cinza.
    expect(badge).toHaveTextContent('▲');
    // Rótulo textual — acessível a leitores de tela e daltônicos.
    expect(badge).toHaveTextContent('Alta');
    expect(badge).toHaveAttribute('data-criticality', 'ALTA');
  });

  it('cobre todas as criticidades do contrato com forma e cor distintas', () => {
    for (const expected of EXPECTED) {
      const { unmount } = render(<CriticalityBadge criticality={expected.criticality} />);
      const badge = screen.getByTestId('criticality-badge');

      expect(badge).toHaveAttribute('data-criticality', expected.criticality);
      expect(badge).toHaveTextContent(expected.label);
      expect(badge).toHaveTextContent(expected.icon);
      expect(badge).toHaveClass(expected.softClass);

      const presentation = CRITICALITY_PRESENTATION[expected.criticality];
      expect(presentation.borderClass).toContain(expected.borderClass);
      expect(presentation.label).toBe(expected.label);
      expect(presentation.icon).toBe(expected.icon);

      unmount();
    }

    expect(EXPECTED).toHaveLength(INCIDENT_CRITICALITIES.length);
  });
});
