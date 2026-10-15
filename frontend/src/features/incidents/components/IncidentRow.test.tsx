import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { createIncidentFixture } from '@/test/factories';

import type { Incident } from '../types';
import { IncidentRow } from './IncidentRow';

interface RenderRowOptions {
  incident?: Incident;
  isFocused?: boolean;
  isSelected?: boolean;
  isPending?: boolean;
  isRecentlyUpdated?: boolean;
  onOpen?: (id: string) => void;
  onFocus?: (id: string) => void;
}

function renderRow({
  incident = createIncidentFixture(),
  isFocused = false,
  isSelected = false,
  isPending = false,
  isRecentlyUpdated = false,
  onOpen = vi.fn(),
  onFocus = vi.fn(),
}: RenderRowOptions = {}) {
  render(
    <TooltipProvider>
      <IncidentRow
        incident={incident}
        density="comfortable"
        isFocused={isFocused}
        isSelected={isSelected}
        isPending={isPending}
        isRecentlyUpdated={isRecentlyUpdated}
        onOpen={onOpen}
        onFocus={onFocus}
      />
    </TooltipProvider>,
  );

  return { onOpen, onFocus };
}

describe('IncidentRow', () => {
  it('mostra código, categoria, status e SLA do incidente', () => {
    renderRow();

    expect(screen.getByText('INC-2026-000123')).toBeInTheDocument();
    expect(screen.getByText('Acidente com Vítimas')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge')).toHaveTextContent('Aberto');
    expect(screen.getByTestId('sla-timer')).toHaveTextContent(/12min/);
    expect(screen.getByTestId('priority-pill')).toHaveTextContent('1340');
  });

  it('abre o incidente ao clicar e marca o foco ao passar o mouse', async () => {
    const user = userEvent.setup();
    const { onOpen, onFocus } = renderRow();
    const row = screen.getByTestId('incident-row');

    await user.click(row);
    expect(onOpen).toHaveBeenCalledWith('0f2c7a10-0000-4000-8000-000000000123');

    await user.hover(row);
    expect(onFocus).toHaveBeenCalledWith('0f2c7a10-0000-4000-8000-000000000123');
  });

  it('aplica a borda esquerda conforme a criticidade (forma redundante à cor)', () => {
    const cases: { criticality: Incident['criticality']; className: string }[] = [
      { criticality: 'ALTA', className: 'border-l-4' },
      { criticality: 'MEDIA', className: 'border-l-[3px]' },
      { criticality: 'BAIXA', className: 'border-l-2' },
    ];

    for (const testCase of cases) {
      const { unmount } = render(
        <TooltipProvider>
          <IncidentRow
            incident={createIncidentFixture({ criticality: testCase.criticality })}
            density="comfortable"
            isFocused={false}
            isSelected={false}
            isPending={false}
            isRecentlyUpdated={false}
            onOpen={vi.fn()}
            onFocus={vi.fn()}
          />
        </TooltipProvider>,
      );

      expect(screen.getByTestId('incident-row')).toHaveClass(testCase.className);
      unmount();
    }
  });

  it('sinaliza mutação em andamento com estado otimista visível', () => {
    renderRow({ isPending: true });

    const row = screen.getByTestId('incident-row');
    expect(row).toHaveClass('opacity-70');
    expect(screen.getByText('enviando…')).toBeInTheDocument();
  });
});
