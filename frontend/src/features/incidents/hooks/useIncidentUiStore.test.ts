import { beforeEach, describe, expect, it } from 'vitest';

import { useIncidentUiStore } from './useIncidentUiStore';

const IDS = ['a', 'b', 'c'];

beforeEach(() => {
  useIncidentUiStore.setState({
    orderedIds: [],
    focusedId: null,
    focusRevealToken: 0,
    selectedId: null,
    recentlyUpdatedId: null,
    conflict: null,
  });
});

/**
 * `focusRevealToken` separa "quem está focado" de "a lista deve rolar até ele".
 * Sem essa separação, o hover programava rolagem e a lista se mexia sozinha
 * (issue #114).
 */
describe('foco e revelação na lista', () => {
  it('foco por mouse não pede revelação', () => {
    useIncidentUiStore.getState().setOrderedIds(IDS);

    useIncidentUiStore.getState().setFocusedId('b');

    expect(useIncidentUiStore.getState().focusedId).toBe('b');
    expect(useIncidentUiStore.getState().focusRevealToken).toBe(0);
  });

  it('abrir pelo clique não pede revelação', () => {
    useIncidentUiStore.getState().setOrderedIds(IDS);

    useIncidentUiStore.getState().openIncident('c');

    expect(useIncidentUiStore.getState().selectedId).toBe('c');
    expect(useIncidentUiStore.getState().focusRevealToken).toBe(0);
  });

  it('j e k pedem revelação a cada passo', () => {
    useIncidentUiStore.getState().setOrderedIds(IDS);

    useIncidentUiStore.getState().focusNext();
    expect(useIncidentUiStore.getState().focusedId).toBe('a');
    expect(useIncidentUiStore.getState().focusRevealToken).toBe(1);

    useIncidentUiStore.getState().focusNext();
    expect(useIncidentUiStore.getState().focusedId).toBe('b');
    expect(useIncidentUiStore.getState().focusRevealToken).toBe(2);

    useIncidentUiStore.getState().focusPrevious();
    expect(useIncidentUiStore.getState().focusedId).toBe('a');
    expect(useIncidentUiStore.getState().focusRevealToken).toBe(3);
  });

  it('navegar com a lista vazia não pede revelação', () => {
    useIncidentUiStore.getState().focusNext();
    useIncidentUiStore.getState().focusPrevious();

    expect(useIncidentUiStore.getState().focusRevealToken).toBe(0);
  });

  it('perder o foco ao filtrar não pede revelação', () => {
    useIncidentUiStore.getState().setOrderedIds(IDS);
    useIncidentUiStore.getState().setFocusedId('b');

    useIncidentUiStore.getState().setOrderedIds(['a']);

    expect(useIncidentUiStore.getState().focusedId).toBeNull();
    expect(useIncidentUiStore.getState().focusRevealToken).toBe(0);
  });
});
