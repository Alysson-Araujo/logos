import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { createIncidentFixtures } from '@/test/factories';

import { DEFAULT_INCIDENT_FILTERS } from '../types';
import { IncidentList, type IncidentListProps } from './IncidentList';

/**
 * O virtualizador é substituído por um dublê: aqui interessa **quando** a lista
 * pede rolagem programática, não a matemática da virtualização (que é da
 * biblioteca). Rolar no hover era a queixa da issue #114.
 */
const { scrollToIndex } = vi.hoisted(() => ({ scrollToIndex: vi.fn() }));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: index,
        start: index * 86,
        size: 86,
        end: (index + 1) * 86,
        lane: 0,
      })),
    getTotalSize: () => options.count * 86,
    scrollToIndex,
    measureElement: () => undefined,
    measure: () => undefined,
  }),
}));

function buildProps(overrides: Partial<IncidentListProps> = {}): IncidentListProps {
  const items = createIncidentFixtures(3);
  return {
    items,
    filters: DEFAULT_INCIDENT_FILTERS,
    total: items.length,
    density: 'comfortable',
    focusedId: null,
    focusRevealToken: 0,
    selectedId: null,
    isInitialLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    failureCount: 0,
    isRetrying: false,
    pendingIds: new Set<string>(),
    recentlyUpdatedId: null,
    onLoadMore: () => undefined,
    onRetry: () => undefined,
    onCreate: () => undefined,
    onOpen: () => undefined,
    onFocus: () => undefined,
    onClearFilters: () => undefined,
    ...overrides,
  };
}

function renderList(props: IncidentListProps) {
  return render(
    <TooltipProvider>
      <IncidentList {...props} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  scrollToIndex.mockClear();
});

describe('rolagem programática da lista', () => {
  it('cada item virtualizado declara data-index para a medição da altura', () => {
    renderList(buildProps());

    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveAttribute('data-index', '0');
  });

  it('não rola quando o foco muda por hover', () => {
    const props = buildProps();
    const { rerender } = renderList(props);

    rerender(
      <TooltipProvider>
        <IncidentList {...props} focusedId={props.items[1]?.id ?? null} />
      </TooltipProvider>,
    );

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('não rola quando o clique seleciona outra linha', () => {
    const props = buildProps();
    const { rerender } = renderList(props);

    rerender(
      <TooltipProvider>
        <IncidentList
          {...props}
          focusedId={props.items[0]?.id ?? null}
          selectedId={props.items[0]?.id ?? null}
        />
      </TooltipProvider>,
    );

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it('rola até a linha focada quando a navegação vem do teclado', () => {
    const props = buildProps();
    const { rerender } = renderList(props);

    rerender(
      <TooltipProvider>
        <IncidentList {...props} focusedId={props.items[1]?.id ?? null} focusRevealToken={1} />
      </TooltipProvider>,
    );

    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'auto' });
  });

  it('não repete a rolagem quando o token não avança', () => {
    const props = buildProps();
    const { rerender } = renderList(props);

    rerender(
      <TooltipProvider>
        <IncidentList {...props} focusedId={props.items[1]?.id ?? null} focusRevealToken={1} />
      </TooltipProvider>,
    );
    scrollToIndex.mockClear();

    // Hover em outra linha: o foco muda, o token não.
    rerender(
      <TooltipProvider>
        <IncidentList {...props} focusedId={props.items[2]?.id ?? null} focusRevealToken={1} />
      </TooltipProvider>,
    );

    expect(scrollToIndex).not.toHaveBeenCalled();
  });
});
