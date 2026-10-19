# Design System

Este documento define os tokens visuais, a regra de redundância de canais, o
cálculo explicável do priority score, os wireframes das telas principais e os
critérios de acessibilidade que a interface do Logos precisa cumprir.

## 1. Princípio que governa o visual

O design do Logos serve a **gestão por exceção**: a tela padrão já responde "o
que está pegando fogo?", e tudo que é normal permanece visualmente silencioso.
Na prática, isso significa que o orçamento de atenção da analista é tratado como
recurso escasso e alocado deliberadamente:

| Recurso visual   | Onde é gasto                           | Onde é negado                              |
| ---------------- | -------------------------------------- | ------------------------------------------ |
| Cor saturada     | Criticidade `ALTA`, SLA vencendo       | `BAIXA`, incidentes em dia                 |
| Peso tipográfico | Código, categoria, tempo em aberto     | Metadados secundários                      |
| Espaço           | Linha selecionada, painel aberto       | Modo compacto para monitoramento longo     |
| Movimento        | Entrada de painel, confirmação de ação | Qualquer coisa em `prefers-reduced-motion` |

## 2. Tokens de cor

As cores vivem em variáveis CSS semânticas, e não em nomes literais espalhados
pelo JSX. Isso é o que permite trocar de tema sem tocar em componente nenhum.

### 2.1 Superfícies e texto

| Token              | Claro     | Escuro    | Uso                             |
| ------------------ | --------- | --------- | ------------------------------- |
| `--bg`             | `#F8FAFC` | `#0B1120` | Fundo da aplicação              |
| `--surface`        | `#FFFFFF` | `#111827` | Cards, linhas da lista, drawer  |
| `--surface-raised` | `#FFFFFF` | `#1F2937` | Modal, popover, command palette |
| `--border`         | `#E2E8F0` | `#1F2937` | Divisórias e contornos          |
| `--border-strong`  | `#CBD5E1` | `#374151` | Contorno de campo em foco/hover |
| `--text`           | `#0F172A` | `#F1F5F9` | Texto principal                 |
| `--text-muted`     | `#475569` | `#94A3B8` | Metadados, rótulos secundários  |
| `--text-subtle`    | `#64748B` | `#64748B` | Texto de apoio, placeholders    |

### 2.2 Criticidade

Três canais redundantes por criticidade — cor, ícone e espessura de borda — mais
o rótulo textual. A tabela é a fonte da verdade para o `CriticalityBadge`.

| Criticidade | Ícone       | Borda esquerda | Fundo tênue (claro) | Cor (claro) | Cor (escuro) |
| ----------- | ----------- | -------------- | ------------------- | ----------- | ------------ |
| **ALTA**    | ▲ triângulo | 4 px           | `#FEF2F2`           | `#DC2626`   | `#F87171`    |
| **MÉDIA**   | ◆ losango   | 3 px           | `#FFFBEB`           | `#D97706`   | `#FBBF24`    |
| **BAIXA**   | ● círculo   | 2 px           | transparente        | `#2563EB`   | `#60A5FA`    |

> **Não confundir criticidade com prioridade.** Criticidade é um **campo** que
> quem relata escolhe. Prioridade é um **cálculo** que o servidor faz (§7) e que
> **ordena a fila**. As duas têm cor própria e vivem em famílias de token
> separadas — `crit-*` e `prio-*` —, justamente para que a borda da linha e o
> selo não digam a mesma coisa com significados diferentes. Ver §2.6.

### 2.3 Status

Pills com fundo suave e texto forte. **Sempre com rótulo textual**, nunca só a
cor.

| Status            | Rótulo PT-BR    | Fundo (claro) | Texto (claro) | Fundo (escuro) | Texto (escuro) |
| ----------------- | --------------- | ------------- | ------------- | -------------- | -------------- |
| `ABERTO`          | Aberto          | `#FFFBEB`     | `#92400E`     | `#422006`      | `#FBBF24`      |
| `EM_INVESTIGACAO` | Em Investigação | `#EFF6FF`     | `#1E40AF`     | `#172554`      | `#93C5FD`      |
| `FECHADO`         | Fechado         | `#F0FDF4`     | `#166534`     | `#052E16`      | `#86EFAC`      |
| `INCONCLUSIVO`    | Inconclusivo    | `#F8FAFC`     | `#475569`     | `#1F2937`      | `#CBD5E1`      |

### 2.4 Estados de sistema

| Token          | Valor     | Uso                                       |
| -------------- | --------- | ----------------------------------------- |
| `--danger`     | `#DC2626` | Erro, SLA vencido, conflito               |
| `--warning`    | `#D97706` | Instabilidade de rede, atenção            |
| `--success`    | `#16A34A` | Confirmação, SLA cumprido                 |
| `--info`       | `#2563EB` | Informação neutra, atualização disponível |
| `--focus-ring` | `#2563EB` | Anel de foco (2 px + 2 px de _offset_)    |

### 2.5 Implementação

O bloco abaixo é um **extrato fiel** de `frontend/src/styles/tokens.css`. A regra
que o arquivo declara no topo vale para todo componente: **nenhuma cor literal**,
tudo passa por estas variáveis, e o tema escuro sobrescreve os mesmos nomes.

```css
/* frontend/src/styles/tokens.css (extrato) */
:root {
  color-scheme: light;

  /* Superfícies */
  --color-bg: #f5f6f8;
  --color-surface: #ffffff;
  --color-surface-raised: #ffffff;
  --color-surface-sunken: #eceff3;
  --color-border: #d5dae2;
  --color-border-strong: #aeb7c4;

  /* Texto */
  --color-fg: #12171f;
  --color-fg-muted: #55606f;
  --color-fg-subtle: #6b7684;

  /* Marca / foco */
  --color-accent: #1d4ed8;
  --color-accent-fg: #ffffff;
  --color-accent-soft: #e3ecfd;

  /* Criticidade — o campo declarado por quem relata */
  --color-crit-alta: #dc2626;
  --color-crit-alta-soft: #fee2e2;
  --color-crit-alta-text: #b91c1c;
  /* … media e baixa seguem o mesmo padrão de três variáveis */

  /* Prioridade — as faixas do score calculado (§2.6) */
  --color-prio-critica: #b91c1c;
  --color-prio-critica-soft: #fee2e2;
  --color-prio-critica-text: #991b1b;
  /* … alta, media e baixa seguem o mesmo padrão */

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-full: 999px;

  --shadow-e1: 0 1px 2px rgb(8 12 18 / 0.06);
  --shadow-e2: 0 4px 12px rgb(8 12 18 / 0.08);
  --shadow-e3: 0 12px 32px rgb(8 12 18 / 0.14);
}

.dark {
  color-scheme: dark;
  /* Sobrescreve os MESMOS nomes. Nenhum componente sabe qual tema está ativo. */
}
```

```ts
// frontend/tailwind.config.ts (trecho)
export default {
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          raised: 'var(--color-surface-raised)',
          sunken: 'var(--color-surface-sunken)',
        },
        border: { DEFAULT: 'var(--color-border)', strong: 'var(--color-border-strong)' },
        fg: {
          DEFAULT: 'var(--color-fg)',
          muted: 'var(--color-fg-muted)',
          subtle: 'var(--color-fg-subtle)',
        },
        'crit-alta': 'var(--color-crit-alta)',
        'prio-critica': 'var(--color-prio-critica)',
        // …
      },
    },
  },
} satisfies import('tailwindcss').Config;
```

> **Por que o prefixo `--color-`.** Ele não é decorativo: separa as variáveis que
> o Tailwind mapeia para classes utilitárias das que são só valores internos
> (`--radius-*`, `--shadow-*`, `--motion-*`). Uma variável sem o prefixo nunca
> vira classe, e é assim que se sabe onde cada uma pode ser usada.

### 2.6 Prioridade — as faixas do score

O score de prioridade (§7) **ordena a fila**. Durante muito tempo ele foi a coisa
menos visível da linha: um número em `text-2xs`, fundo neutro e cor apagada.
Quem tinha cor e ícone era a criticidade — que é um campo, não o resultado do
cálculo.

O problema não é estético. Para ordenar 100 itens por um número, é preciso **ler e
comparar**: cognição serial, centenas de milissegundos por item. O olho processa
antes de ler — posição, cor, forma, tamanho. Um número em texto não está em nenhum
desses canais.

| Faixa       | Score      | Ícone | Borda esquerda | Fundo (claro) | Cor (claro) | Cor (escuro) |
| ----------- | ---------- | ----- | -------------- | ------------- | ----------- | ------------ |
| **CRÍTICA** | ≥ 1100     | ▲     | 4 px           | `#FEE2E2`     | `#B91C1C`   | `#FCA5A5`    |
| **ALTA**    | 900–1099   | ◆     | 3 px           | `#FFEDD5`     | `#EA580C`   | `#FDBA74`    |
| **MÉDIA**   | 700–899    | ●     | 2 px           | `#CFFAFE`     | `#0891B2`   | `#67E8F9`    |
| **BAIXA**   | < 700      | ○     | 1 px           | `#F1F5F9`     | `#64748B`   | `#94A3B8`    |

**As fronteiras não são redondas por estética.** As primeiras que tentamos
(1000/700/400) jogavam **~55% da fila numa faixa só**, e faixa que concentra mais
da metade não ajuda a triar. As finais vieram da distribuição real da base
(120 incidentes — p10=740, p25=780, p50=910, p75=1030, p90=1160, máx=1400) e caem
perto dos quartis.

São **quatro números num lugar só** (`PRIORITY_TIER_THRESHOLDS`, em
`frontend/src/features/incidents/priority.ts`): recalibrar é mudar ali, e o teste
de fronteira diz exatamente o que muda.

**A borda esquerda da linha carrega a prioridade, e não a criticidade.** Ela é o
canal que o olho lê na periferia ao varrer a fila, e a pergunta que a analista faz
é *"onde eu paro?"* — que é a ordem, e a ordem vem do score. A criticidade
continua no selo, com cor, forma e rótulo próprios.

As duas divergem de verdade: um problema mecânico envelhecido passa na frente de
um acidente com vítimas recém-aberto. Há teste guardando exatamente essa
divergência.

**Cor nunca sozinha** (§6): cada faixa tem símbolo geométrico, rótulo textual e
cor — três canais para a mesma informação, e o número ao lado como desempate fino.

## 3. Tipografia

| Item                 | Definição                                                          |
| -------------------- | ------------------------------------------------------------------ |
| Família de UI        | `Inter`, com _fallback_ para `system-ui`, `sans-serif`             |
| Família monoespaçada | `JetBrains Mono` para códigos de incidente, IDs e trechos técnicos |
| Escala               | `12 / 13 / 14 / 16 / 20 / 24 / 32` px                              |
| Pesos                | `400` regular, `500` medium, `600` semibold, `700` bold            |
| Entrelinha           | `1.25` em títulos, `1.5` em corpo, `1.2` em linhas densas da lista |
| Números tabulares    | `tabular-nums` obrigatório em timers, contadores, códigos e scores |

### 3.1 Mapa de uso

| Elemento                                | Tamanho | Peso | Observação                                                                 |
| --------------------------------------- | ------- | ---- | -------------------------------------------------------------------------- |
| Código do incidente (`INC-2026-000123`) | 13 px   | 600  | `JetBrains Mono` + `tabular-nums`, para alinhar verticalmente na varredura |
| Categoria                               | 14 px   | 600  | Caixa alta, é o primeiro campo reconhecido no F-pattern                    |
| Local e placa                           | 13 px   | 400  | `--text-muted`                                                             |
| Badge de criticidade                    | 12 px   | 700  | Caixa alta, sempre acompanhado de ícone e forma                            |
| Pill de status                          | 12 px   | 600  | Rótulo textual obrigatório                                                 |
| Timer de SLA                            | 13 px   | 600  | `tabular-nums`: o número não pode "dançar" a cada segundo                  |
| Score de prioridade                     | 13 px   | 500  | `tabular-nums`, alinhado à direita                                         |
| Título de seção do drawer               | 16 px   | 600  | —                                                                          |
| KPI do topo (contagem)                  | 24 px   | 700  | `tabular-nums`                                                             |
| Título da tela                          | 20 px   | 600  | —                                                                          |

**Por que `tabular-nums` é regra e não preferência:** em uma lista que atualiza
a cada segundo, larguras de dígito variáveis fazem o texto deslocar
lateralmente. Em uma tela que a analista escaneia, movimento não intencional é
ruído.

## 4. Espaçamento, raios e sombras

| Escala de espaçamento | 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48 · 64 px |
| --------------------- | ------------------------------------------- |
| Base                  | 4 px                                        |

| Raio   | Valor   | Aplicação                           |
| ------ | ------- | ----------------------------------- |
| `sm`   | `6px`   | Inputs, botões, badges retangulares |
| `md`   | `10px`  | Cards, linhas da lista, drawer      |
| `full` | `999px` | Pills de status, avatares           |

| Sombra     | Valor                              | Aplicação                      |
| ---------- | ---------------------------------- | ------------------------------ |
| `shadow-1` | `0 1px 2px rgb(15 23 42 / 0.06)`   | Linha em hover                 |
| `shadow-2` | `0 4px 12px rgb(15 23 42 / 0.08)`  | Card em foco, popover          |
| `shadow-3` | `0 12px 32px rgb(15 23 42 / 0.14)` | Modal, drawer, command palette |

Três níveis, sem exceção. Uma quarta sombra não tem função semântica — só
dificulta a leitura de hierarquia.

## 5. Movimento

| Token             | Duração                          | Aplicação                                   |
| ----------------- | -------------------------------- | ------------------------------------------- |
| `--duration-fast` | `150ms`                          | Hover, foco, troca de estado de botão       |
| `--duration-base` | `200ms`                          | Entrada de drawer, abertura de modal, toast |
| Curva             | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Padrão para tudo; sai rápido, chega devagar |

Regras:

1. Nada anima por mais de **200 ms**. Em uma tela que reordena, animação longa
   atrapalha a leitura.
2. A animação comunica **causalidade**, não decoração: o drawer desliza da
   direita porque veio da direita; o toast surge de baixo porque é uma
   confirmação efêmera.
3. `prefers-reduced-motion: reduce` **desliga toda transição não essencial**,
   preservando apenas mudanças instantâneas de estado.

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## 6. Redundância de canais: cor + ícone + forma + texto

### 6.1 A regra

Toda informação de criticidade ou status é transmitida por **quatro canais
simultâneos**:

| Canal | Exemplo em `ALTA`      |
| ----- | ---------------------- |
| Cor   | Vermelho `#DC2626`     |
| Ícone | ▲ triângulo            |
| Forma | Borda esquerda de 4 px |
| Texto | Rótulo "ALTA"          |

Nenhum estado da interface depende **apenas** de cor para ser compreendido.

### 6.2 Por que

**Daltronismo é uma condição, não um caso extremo.** Aproximadamente uma em
cada doze pessoas do sexo masculino tem alguma forma de deficiência na
percepção de cores. A combinação vermelho/verde, a mais comum em interfaces de
severidade, é justamente a mais problemática para deuteranopia e protanopia. Em
uma central de controle, a diferença entre `ALTA` e `BAIXA` é a ordem de
atendimento — errar por cor custa dinheiro.

**Impressão, projetor e monitor ruim destroem a cor.** A sala da central tem
TV ligada, luz ambiente variável e monitores de qualidades diferentes. A cor
que funciona no monitor da estação de trabalho não chega intacta ao décimo
segundo monitor.

**A cor não sobrevive ao modo de alto contraste.** Usuários de Windows de alto
contraste têm as cores sobrescritas pelo sistema. O ícone e o texto continuam.

**A redundância também ajuda quem enxerga toda a paleta.** Ao escanear uma
lista de 50 linhas, o triângulo e a espessura de borda são reconhecidos em
visão periférica mais rápido que a leitura de um rótulo. A redundância não é
custo de acessibilidade — é ganho de velocidade de varredura.

### 6.3 Onde a regra é verificada

- `CriticalityBadge` recebe `criticality` e renderiza os quatro canais; não
  existe prop para renderizar só a cor.
- O teste de componente verifica que, ao remover a classe de cor, o ícone e o
  rótulo continuam presentes no DOM.
- O `SlaTimer` usa cor **e** formato (`mm:ss` textual, barra de progresso e
  rótulo "SLA vencendo"), nunca só a transição para vermelho.

## 7. Priority score: fórmula e exemplo completo

### 7.1 Fórmula

```
score = impacto(categoria) + urgência(criticidade) + aging(horas em aberto) + pressão de SLA

impacto(categoria):
    ACIDENTE_COM_VITIMAS          → 300
    BLOQUEIO_DE_PISTA             → 180
    ACIDENTE_COM_VEICULO          → 150
    CONDICAO_CLIMATICA_ATIPICA    → 100
    PROBLEMA_MECANICO             →  60

urgência(criticidade):
    ALTA  → 500
    MEDIA → 250
    BAIXA →  80

aging(horas_desde_criação) = min(horas * 12, 400)
pressão_de_sla             = 200 se faltam menos de 60 min para o SLA, senão 0
```

### 7.2 Exemplo numérico completo

**Incidente:** `INC-2026-000123`, acidente com vítimas, criticidade `ALTA`,
criado há 4 horas, com SLA vencendo em 12 minutos.

| Componente              | Cálculo                                           | Parcela  |
| ----------------------- | ------------------------------------------------- | -------- |
| Impacto da categoria    | `ACIDENTE_COM_VITIMAS` → tabela                   | **300**  |
| Urgência da criticidade | `ALTA` → tabela                                   | **500**  |
| Aging                   | `min(4 × 12, 400) = min(48, 400)`                 | **48**   |
| Pressão de SLA          | faltam 12 min, que é menos que 60 → teto aplicado | **200**  |
| **Total**               | `300 + 500 + 48 + 200`                            | **1048** |

O mesmo cálculo com a janela de SLA fora do limite crítico (faltando 3 horas)
resulta em `300 + 500 + 48 + 0 = **848**`, e o incidente cai na fila. É esse o
comportamento desejado: **a proximidade do vencimento altera a prioridade**
mais do que quatro horas de espera.

### 7.3 Exemplo de saturação do aging

Um problema mecânico `BAIXA` esquecido por 40 horas:

| Componente     | Cálculo                               | Parcela        |
| -------------- | ------------------------------------- | -------------- |
| Impacto        | `PROBLEMA_MECANICO`                   | 60             |
| Urgência       | `BAIXA`                               | 80             |
| Aging          | `min(40 × 12, 400) = min(480, 400)`   | **400** (teto) |
| Pressão de SLA | fora da janela (SLA de baixa é longo) | 0              |
| **Total**      | `60 + 80 + 400 + 0`                   | **540**        |

Sem o teto, esse caso chegaria a `60 + 80 + 480 = 620` e, em 100 horas,
ultrapassaria qualquer incidente novo de alta criticidade — a fila perderia
valor como sinal. O teto de 400 garante que **tempo sozinho nunca supera
impacto e urgência combinados**, mas ainda assim promove o esquecido acima de
um `BAIXA` recém-criado (140).

### 7.4 Explicabilidade na interface

O score nunca aparece sozinho. O _tooltip_ do `PriorityPill` mostra a
decomposição termo a termo:

```
Prioridade 1.048
  Acidente com vítimas .......... 300
  Criticidade Alta .............. 500
  4h em aberto ................... 48
  SLA vencendo em 12 min ........ 200
```

A analista pode auditar a ordem da fila. Uma ordenação que ela não entende é
uma ordenação em que ela não confia — e, sem confiança, ela volta a ler a lista
inteira, que é exatamente o comportamento que o produto existe para eliminar.

### 7.5 Onde é calculado

No **servidor**, e persistido em `priority_score`. É recalculado na criação, em
cada atualização e em cada leitura. Os motivos estão no
[ADR 0013](adr/0013-priority-score-no-servidor.md): ordem idêntica para
todos os analistas, auditabilidade e testabilidade por faixa.

## 8. Wireframes

### 8.1 Tela principal — triagem

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ LOGOS   Central de Resposta a Incidentes                     [tema]  [config]  A. ▾   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐                          │
│  │ ABERTOS    │ │ EM INVEST. │ │ FECHADOS   │ │ INCONCL.   │    [+ Novo incidente]    │
│  │    142     │ │     37     │ │    986     │ │     49     │                          │
│  │  8 SLA ⚠   │ │            │ │  hoje 61   │ │            │                          │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘                          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  Buscar por código, placa, local, motorista…        [Ctrl+K]      Últimos 24h ▾       │
│  Criticidade: ( Todas )( ALTA 12 )( MÉDIA 44 )( BAIXA 86 )                            │
│  Categoria:   [Acidente com Vítimas ×][Bloqueio de Pista ×]  + adicionar              │
│  Ordenar por: ▾ Prioridade      … Modo compacto      ⟳ ao vivo      Exportar          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ ▍▲ INC-2026-000123   ACIDENTE COM VÍTIMAS                        ● ABERTO    12min ⏱  │
│ ▍  BR-116 km 412, sentido SP · QRD1A23 · há 4h              ▲ ALTA    score 1048      │
│ ──────────────────────────────────────────────────────────────────────────────────── │
│ ▍▲ INC-2026-000187   BLOQUEIO DE PISTA                           ● ABERTO    41min ⏱  │
│ ▍  SP-330 km 88, sentido interior · faixa da direita         ▲ ALTA    score  704     │
│ ──────────────────────────────────────────────────────────────────────────────────── │
│ ▍◆ INC-2026-000201   PROBLEMA MECÂNICO                        ● EM INVEST.   2h   ⏱   │
│ ▍  BR-101 km 220 · ABC4D56 · Ana Paula                       ◆ MÉDIA   score  382     │
│ ──────────────────────────────────────────────────────────────────────────────────── │
│ ▍● INC-2026-000204   CONDIÇÃO CLIMÁTICA ATÍPICA                  ● ABERTO     5h  ⏱   │
│ ▍  BR-376 km 640 · neblina densa                             ● BAIXA   score  288     │
│                                                                                      │
│                        ⟳ 3 novos incidentes — clique para atualizar                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
   j/k navega    Enter abre    s muda status    / busca    f filtros    ? atalhos
```

Notas de leitura do wireframe:

- A coluna de borda esquerda (`▍`) tem espessura variável: 4 px em `ALTA`, 3 px
  em `MÉDIA`, 2 px em `BAIXA`.
- O código fica em fonte monoespaçada, para alinhar verticalmente na varredura.
- O rodapé fixo funciona como descoberta de atalhos: quem não sabe que existem
  atalhos aprende olhando.
- O contador de "3 novos incidentes" aparece **abaixo** da lista e nunca
  reordena as linhas visíveis.

### 8.2 Drawer de detalhe

```
                                        ┌──────────────────────────────────────────┐
                                        │  INC-2026-000123              ▲ ALTA  ✕  │
                                        │  Acidente com Vítimas · score 1048       │
                                        ├──────────────────────────────────────────┤
                                        │  ┌ Status ──────────────────────────┐    │
                                        │  │  ● Aberto        →  [mudar ▾]    │    │
                                        │  │  v3 · lock ativo                 │    │
                                        │  └──────────────────────────────────┘    │
                                        │  SLA: vence em 12min      ████████░░     │
                                        │                                          │
                                        │  Local      BR-116 km 412, sentido SP    │
                                        │  Placa      QRD1A23                      │
                                        │  Motorista  João M.                      │
                                        │  Aberto há  4h por "Rádio Frota 12"      │
                                        │                                          │
                                        │  Transições permitidas:                  │
                                        │   [ Em Investigação ]  [ Inconclusivo ]  │
                                        │   [ Fechar caso ]                        │
                                        ├──────────────────────────────────────────┤
                                        │  Timeline                                │
                                        │  • 12:04  Criado por Rádio Frota 12      │
                                        │  • 12:31  Status → Em Investigação (Ana) │
                                        │  • 13:08  Status → Aberto (Ana)          │
                                        └──────────────────────────────────────────┘
```

Notas de leitura:

- O botão `[mudar ▾]` lista **apenas** as transições válidas; o servidor recusa
  as demais de qualquer forma (defesa em profundidade).
- O campo "v3 · lock ativo" torna o mecanismo de concorrência visível para a
  analista: ela sabe que a tela dela tem uma versão do recurso.
- A timeline é append-only e mostra autor e horário em cada linha.
- A barra de SLA é progressiva: verde, âmbar e vermelho conforme o prazo se
  aproxima.

## 9. Estados de UI

Nenhum estado é implícito. Cada situação tem tratamento definido, texto
próprio e ação disponível.

| Estado              | Gatilho                      | O que a analista vê                                                                                   |
| ------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `initialLoading`    | Primeira carga               | Skeleton com a forma exata da lista (não um spinner centralizado)                                     |
| `refetching`        | Atualização de fundo         | Barra fina no topo; conteúdo permanece visível e interativo                                           |
| `loadingMore`       | Scroll infinito              | Skeleton de 3 linhas ao final da lista                                                                |
| `emptyInitial`      | Nenhum incidente             | Ilustração, _"Nenhum incidente registrado. Boa notícia."_ e CTA `Criar incidente`                     |
| `emptyFiltered`     | Filtro sem resultado         | _"Nenhum resultado para `Alta · Acidente com Vítimas`"_ e botão `Limpar filtros`                      |
| `errorRecoverable`  | `5xx` ou timeout             | Card de erro com `Tentar novamente` (com contagem regressiva); **o cache anterior permanece na tela** |
| `errorFatal`        | `4xx` de contrato            | Mensagem clara e ação `Copiar detalhes técnicos`                                                      |
| `offline`           | `navigator.onLine === false` | Banner fixo _"Sem conexão — exibindo últimos dados. Suas alterações serão enviadas ao reconectar."_   |
| `pendingMutation`   | Mutação em voo               | Botão desabilitado com spinner embutido e barra de progresso na linha                                 |
| `optimisticApplied` | Antes do `200`               | Card atualizado na hora, com opacidade de 70% e ícone de relógio                                      |
| `conflict`          | `409`                        | Modal de conflito com diff campo a campo e três ações                                                 |
| `success`           | `200` ou `201`               | Toast verde por 2,5 s e a linha pisca suavemente                                                      |

### 9.1 Regras que valem para todos os estados

1. **Nunca tela branca.** Todo estado tem conteúdo: skeleton, mensagem ou cache.
2. **Nunca `window.location.reload()`.** Recarregar destrói filtros, scroll e
   posição na fila — o contexto que a analista não pode perder.
3. **Todo estado de erro tem ação.** "Algo deu errado" sem botão é um beco sem
   saída.
4. **Estado de carregamento tem a forma do conteúdo.** Skeleton de lista é uma
   lista de blocos cinza, não um círculo girando no centro.

## 10. Acessibilidade

### 10.1 Critérios

| Critério                     | Como é atendido                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Contraste WCAG AA**        | Mínimo de 4,5:1 em texto normal e 3:1 em texto grande, verificado nos dois temas. <!-- registrar os valores medidos quando a paleta estiver finalizada --> |
| **Foco visível**             | `:focus-visible` com anel de 2 px em `--focus-ring` e `offset` de 2 px, em todos os elementos interativos.                                                 |
| **Navegação por teclado**    | `Tab`, `Shift+Tab`, `Enter`, `Esc`, `j`/`k` na lista, `/` para busca, `f` para filtros, `Ctrl+K` para a command palette, `?` para a lista de atalhos.      |
| **`aria-live`**              | `polite` em toasts, contadores e no aviso de novos incidentes; `assertive` no modal de conflito.                                                           |
| **`aria-label`**             | Obrigatório em todos os botões que contêm apenas ícone.                                                                                                    |
| **Redundância de canais**    | Criticidade e status nunca dependem só de cor.                                                                                                             |
| **`prefers-reduced-motion`** | Todas as transições respeitam a preferência do sistema operacional.                                                                                        |
| **Sem armadilha de foco**    | Modal e drawer prendem o foco enquanto abertos e devolvem o foco ao elemento de origem ao fechar.                                                          |
| **Estrutura semântica**      | Uma `<h1>` por tela, `<table>`/`<ul>` com papéis corretos, `role="status"` para regiões que atualizam sozinhas.                                            |

### 10.2 Ordem de tabulação na tela de triagem

```
KPIs → busca → filtros de criticidade → chips de categoria → ordenação
     → botão "Novo incidente" → linhas da lista → contador de novos
```

A ordem segue a leitura visual da tela. Uma ordem de tabulação que "salta" pela
página é o defeito de acessibilidade mais comum em listas densas.

### 10.3 Regiões dinâmicas

```tsx
// Aviso de novos incidentes: nunca reordena a lista, só informa.
<div role="status" aria-live="polite" aria-atomic="true">
  {newCount > 0 ? `${newCount} novos incidentes — clique para atualizar` : null}
</div>

// Toda mutação em voo é anunciada, para quem usa leitor de tela
// saber que a ação foi disparada antes de o resultado chegar.
<div role="status" aria-live="polite">{pendingMessage}</div>

// O conflito é assertivo: interrompe porque exige decisão.
<Dialog aria-live="assertive" aria-labelledby="conflict-title" />
```

### 10.4 Checklist de verificação

- [ ] Contraste AA nos dois temas, em todos os pares texto/fundo.
- [ ] Foco visível em 100% dos interativos, inclusive chips e pills clicáveis.
- [ ] Fluxo completo executável só com teclado: filtrar → abrir → mudar status.
- [ ] `Esc` fecha modal e drawer e devolve o foco ao gatilho.
- [ ] Toasts e contadores anunciados por leitor de tela.
- [ ] Nenhuma informação transmitida exclusivamente por cor.
- [ ] Zoom de 200% sem quebra de layout.
- [ ] `prefers-reduced-motion` desligando animações não essenciais.
- [ ] No combobox: `↑` `↓` navegam, `Enter` escolhe, `Esc` fecha **a lista** sem
      limpar o campo, e o foco nunca sai do input.
- [ ] Nenhum painel de sugestão aparece quando não há sugestões.

### 10.5 O combobox

Dois campos do formulário de incidente sugerem enquanto se digita: a **placa**
(da frota) e o **local** (dos incidentes já registrados). Os dois usam o mesmo
componente, `frontend/src/components/ui/combobox.tsx`.

**Por que não o `Select` do Radix.** O `Select` só aceita as opções que já
existem: é uma escolha entre alternativas conhecidas. Aqui a pessoa pode digitar
uma placa que **não está** na frota — um caminhão de terceiro — e um local que
nunca foi registrado, e o valor digitado precisa sobreviver. Um `Select` obrigaria
a inventar uma opção "outro" e devolver o texto por fora dele.

**O padrão ARIA seguido:**

| Elemento | Atributo                                   |
| -------- | ------------------------------------------ |
| Input    | `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"` |
| Input    | `aria-activedescendant` apontando para a opção destacada |
| Lista    | `role="listbox"`                           |
| Item     | `role="option"`                            |

**O foco nunca sai do input.** A opção destacada é comunicada por
`aria-activedescendant`, e não movendo o foco — sem isso, quem navega por teclado
ou leitor de tela não teria como saber qual sugestão o `Enter` vai escolher.

**Sem sugestões, nenhum painel.** Não existe "nenhum resultado" embaixo do campo:
enquanto a pessoa digita um local que não está no histórico, um aviso piscando
atrapalha mais do que ajuda. Onde a lista é a única fonte possível — a placa da
frota — a mensagem entra e explica o vazio.

> **Dois defeitos reais que os testes pegaram.**
>
> **O componente forçava caixa alta.** Correto para placa (`ABC1D23`), errado para
> local: "sentido São Paulo" virava "SENTIDO SÃO PAULO". A suposição estava
> embutida no componente e só apareceu no segundo uso — **reusar expõe o que
> ninguém declarou**. O comportamento virou a prop `uppercase`, ligada só onde o
> valor é código.
>
> **O `Esc` fechava o formulário inteiro** em vez de apenas a lista. O Radix fecha
> diálogos com um listener de `Escape` no documento em **fase de captura** —
> qualquer `onKeyDown` no input chega tarde demais, e `stopPropagation` nele não
> faz nada. A solução é um listener de captura registrado em **escopo de módulo**
> (portanto antes de qualquer diálogo montar), com um conjunto de fechadores das
> listas abertas. Com nenhuma lista aberta o conjunto fica vazio, e o `Esc` volta
> a fechar o drawer — que é o esperado.

### 10.6 Layout responsivo

**Uma árvore de elementos, e não duas.** A tabela de contas vira blocos
empilhados abaixo de 768 px, mas o `<table>` continua sendo um `<table>`: quem
muda é o `display`, não o DOM.

A alternativa comum — renderizar cartões no celular e tabela na mesa — foi
implementada primeiro e **reprovada pelos próprios testes**: com as duas versões
no DOM, toda consulta por texto passou a encontrar dois elementos iguais, e três
casos falharam por ambiguidade. O custo não era do teste: era de qualquer leitor
— teste, leitor de tela ou script — que precisasse saber escopar.

**A semântica sobrevive à mudança de layout.** `<tr>` continua sendo `row` e `<th>`
continua sendo `columnheader` em qualquer largura, então leitor de tela e testes
enxergam a mesma estrutura.

**O rótulo que some no celular vem do CSS, e não do DOM.** O cabeçalho da tabela
não aparece em telas estreitas, então a célula de "Último acesso" ganha o rótulo
por `::before`. Pôr o texto num `<span>` escondido teria mudado o conteúdo da
célula — e um teste que compara o valor exato da célula quebraria por causa de uma
decisão de layout. **O que é apresentação não deve entrar no DOM.**

> **O que foi verificado, e o que não foi.** A revisão foi feita por leitura de
> código, arquivo por arquivo. `FiltersBar`, `Header`, `UserMenu`, `Drawer` e
> `Dialog` já estavam corretos (`flex-wrap`, largura cheia, `hidden sm:inline-flex`)
> e não precisaram de mudança. **A verificação em aparelho real não foi feita** —
> é o item que continua aberto, e está registrado como tal.
