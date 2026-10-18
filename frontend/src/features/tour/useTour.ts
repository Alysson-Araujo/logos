import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { create } from 'zustand';

import { TOUR_STEPS, tourSelector, type TourStep, type TourTarget } from './steps';

/** Chave pública do guia: concluir ou pular grava `done`; a presença da chave o desativa. */
export const TOUR_STORAGE_KEY = 'logos.tour.v1';
const TOUR_STORAGE_VALUE = 'done';

/** Espera da triagem: a cada 50 ms, no máximo 40 tentativas (~2 s). */
const AUTO_OPEN_RETRY_MS = 50;
const AUTO_OPEN_MAX_ATTEMPTS = 40;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const CARD_MAX_WIDTH = 360;
const CARD_GAP = 12;
const VIEWPORT_MARGIN = 12;
/** Altura estimada do cartão: decide entre abrir abaixo ou acima do alvo. */
const CARD_ESTIMATED_HEIGHT = 220;
const CARD_MIN_HEIGHT = 160;

/** Retângulo do alvo em coordenadas de viewport. */
export interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

/** Retângulo recortado pela viewport: é ele que as quatro divs escuras contornam. */
export interface TourHole {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
  right: number;
}

export interface TourCardLayout {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

function stepAt(index: number): TourStep {
  return TOUR_STEPS[index] ?? TOUR_STEPS[0];
}

function findTarget(target: TourTarget): Element | null {
  return document.querySelector(tourSelector(target));
}

/**
 * Próximo passo cujo alvo existe no DOM, a partir de `from` (inclusive).
 *
 * Devolve `null` quando não há nenhum naquela direção — é o sinal para encerrar
 * (avançando) ou para não sair do lugar (voltando).
 */
export function findAvailableStep(from: number, direction: 1 | -1): number | null {
  for (let index = from; index >= 0 && index < TOUR_STEPS.length; index += direction) {
    const step = TOUR_STEPS[index];
    if (step !== undefined && findTarget(step.target) !== null) return index;
  }
  return null;
}

export function hasNextStep(index: number): boolean {
  return findAvailableStep(index + 1, 1) !== null;
}

export function hasPreviousStep(index: number): boolean {
  return findAvailableStep(index - 1, -1) !== null;
}

/**
 * Índices dos passos cujo alvo existe no DOM, na ordem do roteiro.
 *
 * É a régua do contador: um passo pulado não entra na conta, então "de 6" vira
 * "de 5" enquanto o botão do cadastro (PR #125) não existir.
 */
export function availableStepIndexes(): number[] {
  const indexes: number[] = [];
  TOUR_STEPS.forEach((step, index) => {
    if (findTarget(step.target) !== null) indexes.push(index);
  });
  return indexes;
}

/** Posição 1-based de `index` entre os passos disponíveis. */
function rankOf(index: number, available: readonly number[]): number {
  return available.filter((candidate) => candidate <= index).length;
}

function sameIndexes(current: readonly number[], next: readonly number[]): boolean {
  return current.length === next.length && current.every((value, index) => value === next[index]);
}

/** Marcado quando o usuário conclui ou pula — não deve abrir sozinho de novo. */
export function hasSeenTour(): boolean {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) !== null;
  } catch {
    // Sem localStorage (modo privado) o guia pode reaparecer: melhor que quebrar.
    return false;
  }
}

function persistTourSeen(): void {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, TOUR_STORAGE_VALUE);
  } catch {
    // Falhar ao persistir não pode impedir o fechamento do guia.
  }
}

interface TourState {
  isOpen: boolean;
  stepIndex: number;
}

interface TourActions {
  /** Abre no primeiro passo cujo alvo existe; sem nenhum alvo, não abre. */
  open: () => void;
  /** Fecha gravando a chave: concluir, pular e `Esc` passam por aqui. */
  dismiss: () => void;
  next: () => void;
  previous: () => void;
  goTo: (index: number) => void;
}

/**
 * Estado do guia fora do React.
 *
 * O botão "?" vive no cabeçalho e o cartão vive na triagem: um store evita
 * prop drilling e mantém `Esc`/botões coerentes com um único `isOpen`.
 */
export const useTourStore = create<TourState & TourActions>()((set, get) => ({
  isOpen: false,
  stepIndex: 0,
  open: () => {
    const first = findAvailableStep(0, 1);
    // Nenhum alvo no DOM: não abre e **não** marca como visto.
    if (first === null) return;
    set({ isOpen: true, stepIndex: first });
  },
  dismiss: () => {
    persistTourSeen();
    set({ isOpen: false, stepIndex: 0 });
  },
  next: () => {
    const target = findAvailableStep(get().stepIndex + 1, 1);
    // Não há mais área para mostrar: "Próximo" no último passo equivale a concluir.
    if (target === null) {
      get().dismiss();
      return;
    }
    set({ stepIndex: target });
  },
  previous: () => {
    const target = findAvailableStep(get().stepIndex - 1, -1);
    if (target === null) return;
    set({ stepIndex: target });
  },
  goTo: (index) => {
    set({ stepIndex: Math.min(Math.max(index, 0), TOUR_STEPS.length - 1) });
  },
}));

/** Abre o guia de fora do React (botão do cabeçalho). */
export function startTour(): void {
  useTourStore.getState().open();
}

export function dismissTour(): void {
  useTourStore.getState().dismiss();
}

/**
 * Cartão abaixo do alvo; acima quando não há espaço. Sempre dentro da viewport:
 * `maxHeight` garante que o rodapé continue visível em telas baixas.
 */
export function computeCardLayout(
  rect: TourRect | null,
  viewportWidth: number,
  viewportHeight: number,
): TourCardLayout {
  const width = Math.min(CARD_MAX_WIDTH, Math.max(viewportWidth - VIEWPORT_MARGIN * 2, 0));
  const anchor = rect ?? {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    bottom: viewportHeight / 2,
    right: 0,
  };

  const below = anchor.bottom + CARD_GAP;
  const above = anchor.top - CARD_GAP - CARD_ESTIMATED_HEIGHT;
  const preferred =
    below + CARD_ESTIMATED_HEIGHT + VIEWPORT_MARGIN <= viewportHeight ? below : above;

  const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN - CARD_MIN_HEIGHT);
  const top = Math.min(Math.max(preferred, VIEWPORT_MARGIN), maxTop);
  const left = Math.min(
    Math.max(anchor.left, VIEWPORT_MARGIN),
    Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN),
  );

  return {
    top,
    left,
    width,
    maxHeight: Math.max(viewportHeight - top - VIEWPORT_MARGIN, CARD_MIN_HEIGHT),
  };
}

/** O buraco do spotlight: o retângulo do alvo recortado pela viewport. */
export function computeHole(
  rect: TourRect,
  viewportWidth: number,
  viewportHeight: number,
): TourHole {
  const top = Math.min(Math.max(rect.top, 0), viewportHeight);
  const left = Math.min(Math.max(rect.left, 0), viewportWidth);
  const bottom = Math.min(Math.max(rect.bottom, top), viewportHeight);
  const right = Math.min(Math.max(rect.right, left), viewportWidth);
  return { top, left, bottom, right, width: right - left, height: bottom - top };
}

/** Elementos focáveis do cartão, na ordem do DOM — base do foco preso. */
export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (container === null) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
  );
}

function sameRect(current: TourRect | null, next: TourRect): boolean {
  return (
    current !== null &&
    current.top === next.top &&
    current.left === next.left &&
    current.width === next.width &&
    current.height === next.height &&
    current.bottom === next.bottom &&
    current.right === next.right
  );
}

export interface UseTourResult {
  isOpen: boolean;
  step: TourStep;
  /** Posição do passo exibido entre os que existem hoje (1 = primeiro). */
  position: number;
  /** Quantos passos existem hoje: alvo ausente não entra na conta. */
  total: number;
  /** `null` enquanto o alvo não foi medido (ou sumiu do DOM). */
  rect: TourRect | null;
  cardRef: RefObject<HTMLDivElement>;
  dismiss: () => void;
  next: () => void;
  previous: () => void;
  canGoNext: boolean;
  canGoPrevious: boolean;
}

/**
 * Liga/desliga, mede o alvo e mantém o guia coerente com o DOM.
 *
 * `ready` é a promessa de que a triagem já renderizou: o tour não dispara em
 * cima do carregamento, e espera o alvo dos KPIs aparecer.
 */
export function useTour(ready: boolean): UseTourResult {
  const isOpen = useTourStore((state) => state.isOpen);
  const stepIndex = useTourStore((state) => state.stepIndex);
  const open = useTourStore((state) => state.open);
  const dismiss = useTourStore((state) => state.dismiss);
  const next = useTourStore((state) => state.next);
  const previous = useTourStore((state) => state.previous);
  const goTo = useTourStore((state) => state.goTo);

  const cardRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<TourRect | null>(null);
  /** Índices dos passos que existem agora — a base do contador. */
  const [available, setAvailable] = useState<readonly number[]>([]);
  const step = stepAt(stepIndex);

  const measure = useCallback((): void => {
    if (!isOpen) {
      setRect(null);
      return;
    }
    // Recontar a cada medição (troca de passo, rolagem e redimensionamento)
    // mantém o contador coerente com o que está na tela.
    const indexes = availableStepIndexes();
    setAvailable((current) => (sameIndexes(current, indexes) ? current : indexes));

    const target = findTarget(step.target);
    if (target === null) {
      setRect(null);
      return;
    }
    const bounds = target.getBoundingClientRect();
    const nextRect: TourRect = {
      top: bounds.top,
      left: bounds.left,
      width: bounds.width,
      height: bounds.height,
      bottom: bounds.bottom,
      right: bounds.right,
    };
    // Só re-renderiza quando o retângulo muda de verdade (rolagem contínua).
    setRect((current) => (sameRect(current, nextRect) ? current : nextRect));
  }, [isOpen, step.target]);

  // Mede antes da pintura e a cada mudança de passo; `scroll` em captura pega
  // também a rolagem interna da lista, que não borbulha até a janela.
  useLayoutEffect(() => {
    measure();
    if (!isOpen) return undefined;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [isOpen, measure]);

  // Alvo sumiu com o guia aberto (filtro esvaziou a lista): pula para o próximo
  // disponível; sem nenhum, encerra em vez de deixar o cartão órfão na tela.
  useEffect(() => {
    if (!isOpen) return;
    if (findTarget(step.target) !== null) return;
    const fallback = findAvailableStep(stepIndex + 1, 1) ?? findAvailableStep(stepIndex - 1, -1);
    if (fallback === null) {
      dismiss();
      return;
    }
    goTo(fallback);
  }, [isOpen, step.target, stepIndex, dismiss, goTo]);

  // Primeira visita: abre só depois que a triagem renderizou e os KPIs existem.
  useEffect(() => {
    if (!ready || isOpen) return;
    if (hasSeenTour()) return;

    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = (): void => {
      if (cancelled) return;
      if (findTarget(TOUR_STEPS[0].target) !== null) {
        open();
        return;
      }
      attempts += 1;
      if (attempts >= AUTO_OPEN_MAX_ATTEMPTS) return;
      timer = setTimeout(attempt, AUTO_OPEN_RETRY_MS);
    };

    attempt();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [ready, isOpen, open]);

  // O cartão recebe o foco ao abrir: leitores de tela entram no diálogo.
  useEffect(() => {
    if (!isOpen) return;
    cardRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  // `Esc` equivale a pular (fecha e grava a chave); `Tab` fica preso no cartão.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== 'Tab') return;

      const card = cardRef.current;
      if (card === null) return;
      const focusables = getFocusableElements(card);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (first === undefined || last === undefined) {
        // Sem nada focável dentro: o foco não pode escapar para o fundo.
        event.preventDefault();
        return;
      }

      const active = document.activeElement;
      const isInside = active !== null && card.contains(active);
      if (event.shiftKey) {
        if (!isInside || active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (!isInside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, dismiss]);

  // O contador fala do roteiro que existe de fato. Antes da primeira medição
  // (mesmo commit, antes da pintura) o total é o do roteiro completo.
  const total = available.length > 0 ? available.length : TOUR_STEPS.length;
  const position = available.length > 0 ? rankOf(stepIndex, available) : stepIndex + 1;

  return {
    isOpen,
    step,
    position,
    total,
    rect,
    cardRef,
    dismiss,
    next,
    previous,
    canGoNext: hasNextStep(stepIndex),
    canGoPrevious: hasPreviousStep(stepIndex),
  };
}
