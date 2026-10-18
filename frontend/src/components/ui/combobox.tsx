import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Fechadores das listas abertas no momento.
 *
 * **Por que um listener de documento em escopo de módulo.** O Radix fecha a
 * sheet no `Escape` com um listener no documento em **fase de captura**. Um
 * `onKeyDown` no input — ou um `stopPropagation` nele — chega tarde demais: a
 * captura no documento acontece antes de o evento descer até o campo, e o
 * formulário inteiro fecha junto com a lista.
 *
 * A única forma de agir antes é registrar um listener de captura no documento
 * que já exista quando o diálogo montar. Em escopo de módulo ele é registrado
 * na primeira importação, ou seja, antes de qualquer diálogo da aplicação —
 * e `stopImmediatePropagation` impede o listener do Radix de rodar.
 *
 * O conjunto fica vazio quando nenhuma lista está aberta, e aí o `Escape` segue
 * o caminho normal e fecha a sheet — que é o comportamento esperado.
 */
const fechadoresDeLista = new Set<() => void>();

if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (evento) => {
      if (evento.key !== 'Escape' || fechadoresDeLista.size === 0) return;

      for (const fechar of fechadoresDeLista) fechar();
      evento.stopImmediatePropagation();
      evento.preventDefault();
    },
    { capture: true },
  );
}

export interface ComboboxOption {
  /** Valor gravado no formulário quando a opção é escolhida. */
  value: string;
  /** Texto principal — a placa. */
  label: string;
  /** Linha de confirmação — modelo e transportadora. */
  description?: string;
}

export interface ComboboxProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Chamado só quando a escolha vem da lista, não a cada tecla. */
  onSelect?: (option: ComboboxOption) => void;
  options: ComboboxOption[];
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Texto do painel quando a busca não devolve nada.
   *
   * **Sem ele, o painel simplesmente não aparece.** É o comportamento certo onde
   * a sugestão é atalho: enquanto a pessoa digita um local que não está no
   * histórico, um "nenhum resultado" piscando embaixo atrapalha mais do que
   * ajuda. Onde a lista é a única fonte possível — a placa da frota — a mensagem
   * entra e explica o vazio.
   */
  emptyMessage?: string;
  /** Texto enquanto a busca está em andamento e ainda não há o que mostrar. */
  loadingMessage?: string;
  /**
   * Trata o valor como código: caixa alta e fonte monoespaçada.
   *
   * Ligado para placa (`ABC1D23`), desligado para texto livre. Sem esta
   * distinção, um local digitado como "sentido São Paulo" viraria "SENTIDO SÃO
   * PAULO" — o texto é da pessoa, não do sistema.
   */
  uppercase?: boolean;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/**
 * Campo de texto com lista de sugestões.
 *
 * **Por que não o `Select` do Radix.** O `Select` só aceita as opções que já
 * existem: ele é uma escolha entre alternativas conhecidas. Aqui a pessoa pode
 * digitar uma placa que **não está** na frota — um caminhão de terceiro, por
 * exemplo — e o valor digitado precisa sobreviver. Um `Select` obrigaria a
 * inventar uma opção "outro" e devolver o texto por fora dele.
 *
 * **Acessibilidade.** Segue o padrão ARIA de combobox: o foco nunca sai do
 * input, e a opção destacada é comunicada por `aria-activedescendant`. Sem isso,
 * quem navega por teclado ou leitor de tela não teria como saber qual sugestão o
 * Enter vai escolher.
 */
export function Combobox({
  id,
  value,
  onValueChange,
  onSelect,
  options,
  isLoading = false,
  disabled = false,
  placeholder,
  emptyMessage,
  loadingMessage = 'Buscando…',
  uppercase = false,
  className,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: ComboboxProps) {
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!aberto) return undefined;

    function aoApontarFora(evento: PointerEvent) {
      if (containerRef.current !== null && !containerRef.current.contains(evento.target as Node)) {
        setAberto(false);
      }
    }

    // `pointerdown` e não `click`: o clique numa opção tira o foco do input
    // antes de virar `click`, e com `click` a lista fecharia antes de a escolha
    // ser registrada — o item clicado nunca seria aplicado.
    document.addEventListener('pointerdown', aoApontarFora);
    return () => {
      document.removeEventListener('pointerdown', aoApontarFora);
    };
  }, [aberto]);

  // O destaque não pode apontar para uma opção que deixou de existir: a lista
  // muda inteira a cada tecla digitada.
  useEffect(() => {
    setAtivo(-1);
  }, [options]);

  // Enquanto a lista está aberta, o Esc é dela — e não do diálogo em volta.
  useEffect(() => {
    if (!aberto) return undefined;

    const fechar = () => {
      setAberto(false);
      setAtivo(-1);
    };
    fechadoresDeLista.add(fechar);
    return () => {
      fechadoresDeLista.delete(fechar);
    };
  }, [aberto]);

  const expandido = aberto && !disabled;

  // Sem nada para mostrar, o painel não é renderizado — nem um `<ul>` vazio.
  const temConteudo = options.length > 0 || isLoading || emptyMessage !== undefined;

  function escolher(indice: number) {
    const opcao = options[indice];
    if (opcao === undefined) return;
    onValueChange(opcao.value);
    onSelect?.(opcao);
    setAberto(false);
    setAtivo(-1);
  }

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (!aberto) {
        setAberto(true);
        return;
      }
      if (options.length === 0) return;
      const passo = evento.key === 'ArrowDown' ? 1 : -1;
      setAtivo((atual) => {
        const proximo = atual + passo;
        // Circula nas pontas: parar na última obrigaria a subir a lista inteira
        // para voltar à primeira.
        if (proximo < 0) return options.length - 1;
        if (proximo >= options.length) return 0;
        return proximo;
      });
      return;
    }

    if (evento.key === 'Enter' && aberto && ativo >= 0) {
      // Sem `preventDefault`, o Enter escolheria a sugestão E enviaria o
      // formulário — gravando um incidente que a pessoa ainda estava preenchendo.
      evento.preventDefault();
      escolher(ativo);
      return;
    }

    if (evento.key === 'Escape' && aberto) {
      // `stopPropagation` além do `preventDefault`: o Radix da sheet escuta
      // `keydown` no documento, e sem parar a propagação o Esc fecharia o
      // formulário inteiro em vez de apenas a lista. Com a lista já fechada o
      // evento segue o caminho normal e fecha a sheet — que é o esperado.
      evento.preventDefault();
      evento.stopPropagation();
      setAberto(false);
      setAtivo(-1);
      return;
    }

    if (evento.key === 'Tab') {
      setAberto(false);
    }
  }

  const idAtivo = ativo >= 0 ? `${listboxId}-opcao-${ativo}` : undefined;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Input
        id={id}
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize={uppercase ? 'characters' : 'none'}
        aria-expanded={expandido}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={idAtivo}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        className={cn(
          uppercase && 'font-mono uppercase placeholder:font-sans placeholder:normal-case',
          ariaInvalid === true && 'border-danger',
        )}
        onChange={(evento) => {
          // A caixa alta aparece enquanto se digita; espaço e hífen saem na
          // normalização do schema, no envio. Só onde o valor é código.
          onValueChange(uppercase ? evento.target.value.toUpperCase() : evento.target.value);
          setAberto(true);
        }}
        onFocus={() => {
          setAberto(true);
        }}
        onKeyDown={aoTeclar}
      />

      {expandido && temConteudo ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Sugestões de placa"
          className={cn(
            'absolute z-50 mt-1 max-h-64 w-full overflow-auto overscroll-contain',
            'rounded-sm border border-border bg-surface py-1 shadow-e2',
          )}
        >
          {isLoading && options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-fg-subtle">{loadingMessage}</li>
          ) : null}

          {!isLoading && options.length === 0 && emptyMessage !== undefined ? (
            <li className="px-3 py-2 text-sm text-fg-subtle">{emptyMessage}</li>
          ) : null}

          {options.map((opcao, indice) => (
            <li
              key={opcao.value}
              id={`${listboxId}-opcao-${indice}`}
              role="option"
              aria-selected={indice === ativo}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm',
                // `min-h-11` (44px): o alvo mínimo confortável no celular, onde
                // a lista é tocada com o polegar e não com o mouse.
                'min-h-11',
                indice === ativo ? 'bg-surface-2 text-fg' : 'text-fg-muted',
              )}
              onPointerDown={(evento) => {
                // Impede que o input perca o foco antes de a escolha acontecer.
                evento.preventDefault();
                escolher(indice);
              }}
              onPointerMove={() => {
                setAtivo(indice);
              }}
            >
              <span className="font-mono font-medium uppercase text-fg">{opcao.label}</span>
              {opcao.description === undefined ? null : (
                <span className="block text-2xs text-fg-subtle">{opcao.description}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
