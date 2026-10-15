import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('vazio inicial: boa notícia + CTA de criar incidente', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<EmptyState variant="initial" onCreate={onCreate} />);

    expect(screen.getByTestId('empty-state-initial')).toBeInTheDocument();
    expect(screen.getByText('Nenhum incidente registrado. Boa notícia.')).toBeInTheDocument();
    expect(screen.queryByText('Limpar filtros')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Criar incidente' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('vazio filtrado: descreve os filtros ativos e oferece limpar', async () => {
    const user = userEvent.setup();
    const onClearFilters = vi.fn();
    render(
      <EmptyState
        variant="filtered"
        filterDescriptions={['Alta', 'Acidente com Vítimas']}
        onClearFilters={onClearFilters}
      />,
    );

    expect(screen.getByTestId('empty-state-filtered')).toBeInTheDocument();
    expect(
      screen.getByText('Nenhum resultado para Alta · Acidente com Vítimas'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Nenhum incidente registrado. Boa notícia.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });
});
