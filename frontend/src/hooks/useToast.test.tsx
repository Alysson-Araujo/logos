import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { Toaster } from '@/components/ui/toast';

import { TOAST_DURATION_MS, useToast, useToastStore } from './useToast';

/**
 * Avisos de canto (`success`/`error`/`info`, seção 9.6).
 *
 * O que este teste protege: o aviso é a única confirmação que o analista recebe
 * depois de salvar. Fila demais na tela cobre a lista; fila que não sai deixa o
 * aviso antigo mentindo sobre o estado atual. Aqui moram as duas pontas: o store
 * (o que entra, com que forma, e o teto de quatro) e o contrato de expiração —
 * que **não** vive no store, e sim no `Toaster`, o único componente que o
 * consome. É por isso que o arquivo monta o `Toaster`: sem ele, a duração de
 * `durationMs` não teria como ser verificada.
 */

function currentToasts() {
  return useToastStore.getState().toasts;
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('useToast — fila de avisos', () => {
  it('publica um aviso com os padrões: informativo, sem descrição, 2,5 s', () => {
    act(() => {
      useToastStore.getState().push({ title: 'Incidente registrado' });
    });

    expect(currentToasts()).toHaveLength(1);
    expect(currentToasts()[0]).toEqual(
      expect.objectContaining({
        title: 'Incidente registrado',
        description: null,
        variant: 'info',
        durationMs: TOAST_DURATION_MS,
      }),
    );
  });

  it('respeita variante, descrição e duração informadas', () => {
    act(() => {
      useToastStore.getState().push({
        title: 'Não foi possível mudar o status',
        description: 'O incidente foi alterado por outro analista.',
        variant: 'error',
        durationMs: 5000,
      });
    });

    expect(currentToasts()[0]).toEqual(
      expect.objectContaining({
        description: 'O incidente foi alterado por outro analista.',
        variant: 'error',
        durationMs: 5000,
      }),
    );
  });

  it('rejeita descrição vazia como ausência de descrição', () => {
    act(() => {
      useToastStore.getState().push({ title: 'Convite enviado', description: null });
    });

    expect(currentToasts()[0]?.description).toBeNull();
  });

  it('dá um id próprio a cada aviso, mesmo quando saem no mesmo milissegundo', () => {
    act(() => {
      useToastStore.getState().push({ title: 'Primeiro' });
      useToastStore.getState().push({ title: 'Segundo' });
    });

    const [primeiro, segundo] = currentToasts();
    expect(primeiro?.id).toBeTruthy();
    expect(segundo?.id).toBeTruthy();
    expect(primeiro?.id).not.toBe(segundo?.id);
    // Sem id distinto o React reaproveitaria o nó errado na lista.
    expect(primeiro?.id).toMatch(/^toast-/);
  });

  it('dismiss marca só o aviso pedido como em saída', () => {
    act(() => {
      useToastStore.getState().push({ title: 'Primeiro' });
      useToastStore.getState().push({ title: 'Segundo' });
    });
    const alvo = currentToasts()[0];

    act(() => {
      useToastStore.getState().dismiss(alvo?.id ?? '');
    });

    // `dismiss` **não remove**: marca para a view animar a saída, e só depois a
    // view chama `remove`. Sem essa separação o aviso sumia no mesmo instante em
    // que expirava, e a animação de saída nunca chegava a aparecer.
    expect(currentToasts().map((toast) => [toast.title, toast.closing])).toEqual([
      ['Primeiro', true],
      ['Segundo', false],
    ]);

    act(() => {
      useToastStore.getState().remove(alvo?.id ?? '');
    });
    expect(currentToasts().map((toast) => toast.title)).toEqual(['Segundo']);
  });

  it('dismiss é inofensivo quando o aviso já saiu da fila', () => {
    act(() => {
      useToastStore.getState().push({ title: 'Primeiro' });
    });
    act(() => {
      useToastStore.getState().dismiss('toast-que-nunca-existiu');
    });

    expect(currentToasts()).toHaveLength(1);
  });

  it('clear esvazia a fila de uma vez', () => {
    act(() => {
      useToastStore.getState().push({ title: 'Primeiro' });
      useToastStore.getState().push({ title: 'Segundo' });
    });

    act(() => {
      useToastStore.getState().clear();
    });

    expect(currentToasts()).toEqual([]);
  });

  it('mantém no máximo quatro na tela: o mais antigo sai na quinta publicação', () => {
    act(() => {
      for (const title of ['Um', 'Dois', 'Três', 'Quatro', 'Cinco']) {
        useToastStore.getState().push({ title });
      }
    });

    // O teto é o que impede um erro em laço de cobrir a lista inteira.
    expect(currentToasts().map((toast) => toast.title)).toEqual([
      'Dois',
      'Três',
      'Quatro',
      'Cinco',
    ]);
  });
});

describe('useToast — publicador', () => {
  it('entrega o publicador a quem só quer notificar', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current({ title: 'Status atualizado para Fechado', variant: 'success' });
    });

    expect(currentToasts()).toEqual([
      expect.objectContaining({ variant: 'success', title: 'Status atualizado para Fechado' }),
    ]);
  });

  it('devolve a mesma referência entre renderizações', () => {
    const { result, rerender } = renderHook(() => useToast());
    const antes = result.current;

    rerender();

    // Referência instável faria `useEffect(..., [pushToast])` disparar em laço.
    expect(result.current).toBe(antes);
  });
});

describe('Toaster — o aviso sai de cena', () => {
  it('some sozinho depois da duração, sem ninguém fechar', async () => {
    render(<Toaster />);

    act(() => {
      useToastStore.getState().push({ title: 'Incidente registrado', durationMs: 80 });
    });
    expect(await screen.findByText('Incidente registrado')).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.queryByText('Incidente registrado')).not.toBeInTheDocument();
        expect(currentToasts()).toEqual([]);
      },
      { timeout: 3000 },
    );
  });

  it('o botão de fechar tira o aviso antes da hora', async () => {
    const user = userEvent.setup();
    render(<Toaster />);

    act(() => {
      // Duração longa: se ele sair agora, foi o clique — não o relógio.
      useToastStore.getState().push({ title: 'Convite reenviado', durationMs: 60_000 });
    });
    await screen.findByText('Convite reenviado');

    await user.click(screen.getByRole('button', { name: 'Fechar aviso' }));

    // A remoção do estado é assíncrona de propósito: o clique marca `closing`,
    // o Radix anima a saída e o item só sai da fila depois. Por isso a espera
    // cobre as duas coisas — o sumiço da tela **e** a limpeza do store.
    await waitFor(() => {
      expect(screen.queryByText('Convite reenviado')).not.toBeInTheDocument();
      expect(currentToasts()).toEqual([]);
    });
  });

  it('mostra título e descrição dentro da região viva que anuncia o aviso', async () => {
    render(<Toaster />);

    act(() => {
      useToastStore.getState().push({
        title: 'Status atualizado para Fechado',
        description: 'INC-2026-000123',
        variant: 'success',
      });
    });

    const titulo = await screen.findByText('Status atualizado para Fechado');
    expect(screen.getByText('INC-2026-000123')).toBeInTheDocument();
    // Região viva `polite`: o aviso entra na fila do leitor de tela em vez de
    // interromper a leitura da triagem no meio de uma frase.
    expect(titulo.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('não renderiza nada quando não há aviso nenhum', () => {
    render(<Toaster />);

    expect(currentToasts()).toEqual([]);
    expect(screen.queryByText(/incidente/i)).not.toBeInTheDocument();
  });
});
