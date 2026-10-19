/**
 * Passos do guia de boas-vindas (issue #131).
 *
 * O tour não conhece componentes: ele procura os alvos no DOM pelo atributo
 * `data-tour`. Quem marca as áreas reais da triagem é `KpiCards`, `FiltersBar`
 * e `IncidentList`; o cabeçalho marca o tema (`ThemeToggle`), o indicador de
 * conexão e o próprio botão "Guia"; e o rodapé (`AppFooter`) marca os atalhos.
 * Aqui ficam só os textos e os seletores.
 *
 * Os textos são **literais** do Figma: nada de crase nem markdown, porque o
 * cartão renderiza `body` como texto puro — crase apareceria na tela.
 */

/** Identificadores das áreas destacadas — viram `data-tour="<id>"` no DOM. */
export type TourTarget =
  'kpis' | 'filters' | 'list' | 'create' | 'theme' | 'connection' | 'shortcuts' | 'guide';

export interface TourStep {
  target: TourTarget;
  /** Título do cartão. O primeiro passo é a saudação. */
  title: string;
  /** Explicação da área destacada. */
  body: string;
}

export const TOUR_STEPS = [
  {
    target: 'kpis',
    title: 'Boas-vindas ao Logos',
    body: 'O resumo em tempo real. Quantos incidentes estão em cada etapa — clique para filtrar a fila.',
  },
  {
    target: 'filters',
    title: 'Busca e filtros',
    body: 'Busque por código, placa, local ou título. Os filtros de criticidade, categoria e status combinam entre si, e o filtro fica na URL: o link que você copia abre a mesma visão para outra pessoa.',
  },
  {
    target: 'list',
    title: 'A fila priorizada',
    body: 'A ordem não é manual: cada incidente tem um score calculado pela criticidade e pelo tempo em aberto. O relógio à direita mostra o prazo de atendimento — quando fica vermelho, o prazo estourou. Atalhos: j e k navegam, Enter abre, / busca.',
  },
  {
    // Passo com efeito colateral: ativo, ele abre a `CreateIncidentSheet` pelo
    // mesmo handler do botão "Novo incidente" (ver `useTour`).
    target: 'create',
    title: 'Registrar incidente',
    body: 'O botão de novo incidente abre o formulário: título, categoria, criticidade e reportado por. O prazo de atendimento nasce da criticidade escolhida — ALTA 2 h, MÉDIA 8 h, BAIXA 24 h.',
  },
  {
    target: 'theme',
    title: 'Tema',
    body: 'Alterne entre claro e escuro no botão de sol/lua. A escolha fica salva no navegador e não muda nada nos dados.',
  },
  {
    target: 'connection',
    title: 'Conexão',
    body: 'Este indicador mostra se a API está respondendo. Sem conexão, a fila continua com o último estado carregado e avisa antes de qualquer ação que precise do servidor.',
  },
  {
    target: 'shortcuts',
    title: 'Atalhos do teclado',
    body: 'Sem tirar a mão do teclado: j e k navegam pela fila, Enter abre o incidente, / busca, t alterna o tema e Esc fecha o que estiver aberto.',
  },
  {
    target: 'guide',
    title: 'Sempre que precisar',
    body: 'Ficou com dúvida? Clique em Guia, aqui no cabeçalho, para rever este passeio a qualquer momento.',
  },
] as const satisfies readonly TourStep[];

/** O passo cujo alvo é o cadastro — o único que abre uma janela. */
export const CREATE_STEP_TARGET: TourTarget = 'create';

/** Seletor do alvo de um passo — a única forma de descobrir a área. */
export function tourSelector(target: TourTarget): string {
  return `[data-tour="${target}"]`;
}
