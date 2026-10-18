import { useId } from 'react';

import { Button } from '@/components/ui/button';

import { computeCardLayout, computeHole, useTour } from './useTour';

export interface WelcomeTourProps {
  /**
   * `true` só quando a triagem já renderizou. Enquanto for `false` o guia não
   * dispara sozinho — nada de tour em cima de skeleton de carregamento.
   */
  ready?: boolean;
}

/**
 * Fundo escuro das quatro faixas.
 *
 * `bg-overlay/60` **não funciona** com este token: o Tailwind 3.4 não consegue
 * aplicar o modificador de opacidade sobre `var(--color-overlay)` (a regra nem
 * é gerada — verificado no CSS emitido). Como `--color-overlay` já é um `rgba`,
 * a opacidade entra pela camada de composição: mesmo resultado, sem tocar nos
 * tokens nem no `tailwind.config.ts`.
 */
const OVERLAY_CLASS = 'fixed z-[60] bg-overlay opacity-60';

/**
 * Guia de boas-vindas (issue #131).
 *
 * O corte é feito com quatro divs escuras — topo, baixo, esquerda e direita — em
 * volta do retângulo do alvo, e não com um buraco recortado: assim a área
 * destacada fica **realmente limpa** (cliques continuam chegando nela) e o
 * contorno é um anel por cima, sem capturar ponteiro.
 */
export function WelcomeTour({ ready = true }: WelcomeTourProps) {
  const {
    isOpen,
    step,
    position,
    total,
    rect,
    cardRef,
    dismiss,
    next,
    previous,
    canGoNext,
    canGoPrevious,
  } = useTour(ready);
  const titleId = useId();
  const bodyId = useId();

  if (!isOpen) return null;

  const hole = rect === null ? null : computeHole(rect, window.innerWidth, window.innerHeight);
  // Sem medição ainda (primeiro frame): o cartão nasce abaixo da dobra do alvo
  // e o fundo escuro só entra junto com o retângulo.
  const layout = computeCardLayout(rect, window.innerWidth, window.innerHeight);

  return (
    <>
      {hole === null ? null : (
        <>
          {/* As quatro faixas escuras ao redor do alvo. */}
          <div
            aria-hidden="true"
            className={`${OVERLAY_CLASS} inset-x-0 top-0`}
            style={{ height: hole.top }}
          />
          <div
            aria-hidden="true"
            className={`${OVERLAY_CLASS} inset-x-0 bottom-0`}
            style={{ top: hole.bottom }}
          />
          <div
            aria-hidden="true"
            className={`${OVERLAY_CLASS} left-0`}
            style={{ top: hole.top, height: hole.height, width: hole.left }}
          />
          <div
            aria-hidden="true"
            className={`${OVERLAY_CLASS} right-0`}
            style={{ top: hole.top, height: hole.height, left: hole.right }}
          />
          {/* Contorno do alvo: `pointer-events-none` para o clique atravessar. */}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[60] rounded-md ring-2 ring-accent"
            style={{
              top: hole.top,
              left: hole.left,
              width: hole.width,
              height: hole.height,
            }}
          />
        </>
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className="fixed z-[61] flex flex-col gap-3 overflow-y-auto rounded-md bg-surface-raised p-4 shadow-e3 outline-none"
        style={{
          top: layout.top,
          left: layout.left,
          width: layout.width,
          maxHeight: layout.maxHeight,
        }}
      >
        {/* `aria-live`: cada troca de passo é anunciada mesmo com o foco no botão. */}
        <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-1.5">
          <h2 id={titleId} className="text-base font-semibold text-fg">
            {step.title}
          </h2>
          <p id={bodyId} className="text-sm text-fg-muted">
            {step.body}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-border pt-3">
          <div className="flex items-center gap-1">
            <span className="font-mono text-2xs nums text-fg-subtle">
              {`Passo ${String(position)} de ${String(total)}`}
            </span>
            <Button variant="link" size="sm" onClick={dismiss} className="px-1">
              Pular
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={previous} disabled={!canGoPrevious}>
              Anterior
            </Button>
            <Button variant="primary" size="sm" onClick={canGoNext ? next : dismiss}>
              {canGoNext ? 'Próximo' : 'Concluir'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
