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
  it('mostra código, categoria, status e o prazo do incidente', () => {
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

  it('aplica a borda esquerda conforme a faixa de PRIORIDADE', () => {
    // A borda carrega a prioridade, e não a criticidade. Ela é o canal que o olho
    // lê na periferia ao varrer a fila, e a pergunta que o analista faz é "onde
    // eu paro?" — que é a ordem, e a ordem vem do score calculado.
    const cases: { score: number; className: string }[] = [
      { score: 1200, className: 'border-l-4' },
      { score: 950, className: 'border-l-[3px]' },
      { score: 750, className: 'border-l-2' },
      { score: 400, className: 'border-l' },
    ];

    for (const testCase of cases) {
      const { unmount } = render(
        <TooltipProvider>
          <IncidentRow
            incident={createIncidentFixture({ priorityScore: testCase.score })}
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

  it('a borda segue o score, e não a criticidade declarada', () => {
    // A regressão que este teste guarda: antes a borda vinha da criticidade, e as
    // duas coisas divergem de verdade — um problema mecânico envelhecido passa na
    // frente de um acidente com vítimas recém-aberto.
    const { unmount: unmountAntigo } = render(
      <TooltipProvider>
        <IncidentRow
          incident={createIncidentFixture({ criticality: 'ALTA', priorityScore: 400 })}
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

    // Criticidade ALTA, mas score baixo: borda fina.
    expect(screen.getByTestId('incident-row')).toHaveClass('border-l');
    expect(screen.getByTestId('incident-row')).not.toHaveClass('border-l-4');
    unmountAntigo();

    const { unmount: unmountNovo } = render(
      <TooltipProvider>
        <IncidentRow
          incident={createIncidentFixture({ criticality: 'BAIXA', priorityScore: 1200 })}
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

    // Criticidade BAIXA, mas score altíssimo: borda grossa.
    expect(screen.getByTestId('incident-row')).toHaveClass('border-l-4');
    unmountNovo();
  });

  it('sinaliza mutação em andamento com estado otimista visível', () => {
    renderRow({ isPending: true });

    const row = screen.getByTestId('incident-row');
    expect(row).toHaveClass('opacity-70');
    expect(screen.getByText('enviando…')).toBeInTheDocument();
  });
});
