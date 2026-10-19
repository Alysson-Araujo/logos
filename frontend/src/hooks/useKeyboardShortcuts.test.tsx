import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useKeyboardShortcuts, type KeyboardShortcutHandlers } from './useKeyboardShortcuts';

/**
 * Atalhos no estilo Gmail: `j`/`k` navegam, `Enter` abre, `/` busca, `t` alterna
 * o tema e `Esc` fecha o que estiver aberto.
 *
 * O que este teste protege: duas armadilhas opostas. A primeira é o atalho
 * disparar enquanto a pessoa escreve — `j` dentro do campo de busca tem que virar
 * a letra "j", e não "próximo incidente"; pior ainda seria `/` abrir a busca no
 * meio de um texto. A segunda é o atalho **não** disparar quando deveria, porque
 * o handler novo ficou preso num ref velho ou porque `enabled=false` não desligou
 * coisa alguma. `Esc` é a exceção desenhada de propósito: fecha a camada de cima
 * mesmo com o foco dentro de um campo, senão não haveria como sair do drawer.
 */

function renderShortcuts(enabled = true) {
  const handlers: Required<KeyboardShortcutHandlers> = {
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onOpen: vi.fn(),
    onFocusSearch: vi.fn(),
    onEscape: vi.fn(),
    onToggleTheme: vi.fn(),
  };

  const view = renderHook(() => {
    useKeyboardShortcuts(handlers, enabled);
  });

  return { ...view, handlers };
}

/** Tecla pressionada na janela — o nível em que o listener vive. */
function press(key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(window, { key, ...init });
}

/**
 * Mesma tecla, mas com o evento em mãos: é o único jeito de perguntar se o
 * handler cancelou o comportamento padrão do navegador.
 */
function pressAndInspect(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts — atalhos', () => {
  it('j e k navegam para o próximo e para o anterior', () => {
    const { handlers } = renderShortcuts();

    press('j');
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onPrevious).not.toHaveBeenCalled();

    press('k');
    expect(handlers.onPrevious).toHaveBeenCalledTimes(1);
  });

  it('Enter abre o incidente focado e t alterna o tema', () => {
    const { handlers } = renderShortcuts();

    press('Enter');
    press('t');

    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('/ pede o foco na busca e Esc fecha a camada aberta', () => {
    const { handlers } = renderShortcuts();

    press('/');
    press('Escape');

    expect(handlers.onFocusSearch).toHaveBeenCalledTimes(1);
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });

  it('cancela o padrão do navegador em j, k e / (nada de rolar a página)', () => {
    renderShortcuts();

    // Sem `preventDefault`, `j`/`k` rolam a lista e `/` abre a busca rápida do
    // Firefox por cima da aplicação.
    expect(pressAndInspect('j').defaultPrevented).toBe(true);
    expect(pressAndInspect('k').defaultPrevented).toBe(true);
    expect(pressAndInspect('/').defaultPrevented).toBe(true);
    // `t` e `Enter` não mexem no padrão: quem decide é o handler.
    expect(pressAndInspect('t').defaultPrevented).toBe(false);
    expect(pressAndInspect('Enter').defaultPrevented).toBe(false);
  });

  it('ignora teclas que não têm atalho', () => {
    const { handlers } = renderShortcuts();

    for (const key of ['a', 'ArrowDown', ' ', 'F5']) {
      press(key);
    }

    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onPrevious).not.toHaveBeenCalled();
    expect(handlers.onOpen).not.toHaveBeenCalled();
    expect(handlers.onFocusSearch).not.toHaveBeenCalled();
    expect(handlers.onToggleTheme).not.toHaveBeenCalled();
    expect(handlers.onEscape).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts — campos de texto', () => {
  /** Um alvo de digitação de cada tipo que a triagem tem. */
  function renderTypingTargets(): {
    campo: HTMLElement;
    area: HTMLElement;
    lista: HTMLElement;
    editor: HTMLElement;
  } {
    render(
      <>
        <input aria-label="Busca" />
        <textarea aria-label="Descrição" />
        <select aria-label="Status">
          <option>Aberto</option>
        </select>
        <div aria-label="Editor" contentEditable />
      </>,
    );

    const editor = screen.getByLabelText('Editor');
    // O jsdom não implementa `isContentEditable` (a propriedade não existe no
    // protótipo); sem esta linha o teste mediria o jsdom, não o hook.
    Object.defineProperty(editor, 'isContentEditable', { configurable: true, value: true });

    return {
      campo: screen.getByLabelText('Busca'),
      area: screen.getByLabelText('Descrição'),
      lista: screen.getByLabelText('Status'),
      editor,
    };
  }

  it('não dispara atalho nenhum com o foco num campo de texto', () => {
    const { handlers } = renderShortcuts();
    const alvos = renderTypingTargets();

    for (const alvo of [alvos.campo, alvos.area, alvos.lista, alvos.editor]) {
      for (const key of ['j', 'k', 't', '/', 'Enter']) {
        fireEvent.keyDown(alvo, { key });
      }
    }

    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onPrevious).not.toHaveBeenCalled();
    expect(handlers.onToggleTheme).not.toHaveBeenCalled();
    expect(handlers.onFocusSearch).not.toHaveBeenCalled();
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it('Esc continua fechando a camada de cima com o foco dentro do campo', () => {
    const { handlers } = renderShortcuts();
    const { campo } = renderTypingTargets();

    fireEvent.keyDown(campo, { key: 'Escape' });

    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });
});

describe('useKeyboardShortcuts — combinações e ciclo de vida', () => {
  it('ignora o atalho quando vem com Ctrl, ⌘ ou Alt', () => {
    const { handlers } = renderShortcuts();

    press('j', { ctrlKey: true });
    press('k', { metaKey: true });
    press('t', { altKey: true });
    press('/', { ctrlKey: true });

    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onPrevious).not.toHaveBeenCalled();
    expect(handlers.onToggleTheme).not.toHaveBeenCalled();
    expect(handlers.onFocusSearch).not.toHaveBeenCalled();
  });

  it('com enabled=false nenhum atalho responde, nem o Esc', () => {
    const { handlers } = renderShortcuts(false);

    press('j');
    press('k');
    press('Escape');
    press('/');

    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onPrevious).not.toHaveBeenCalled();
    expect(handlers.onEscape).not.toHaveBeenCalled();
    expect(handlers.onFocusSearch).not.toHaveBeenCalled();
  });

  it('usa o handler mais recente sem recriar o listener', () => {
    const primeiro = vi.fn();
    const segundo = vi.fn();
    const { rerender } = renderHook(
      ({ onNext }: { onNext: () => void }) => {
        useKeyboardShortcuts({ onNext });
      },
      { initialProps: { onNext: primeiro } },
    );

    press('j');
    expect(primeiro).toHaveBeenCalledTimes(1);

    // O `App` recria os handlers a cada render: o listener precisa enxergar o
    // novo, senão `j` chamaria a versão com estado velho para sempre.
    rerender({ onNext: segundo });
    press('j');

    expect(primeiro).toHaveBeenCalledTimes(1);
    expect(segundo).toHaveBeenCalledTimes(1);
  });

  it('para de responder depois de desmontar', () => {
    const { handlers, unmount } = renderShortcuts();

    unmount();
    press('j');
    press('Escape');

    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onEscape).not.toHaveBeenCalled();
  });
});
