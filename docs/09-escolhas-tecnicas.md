# Escolhas Técnicas

Para cada biblioteca e tecnologia usada no Logos: o que ela resolve **neste**
projeto, qual seria a alternativa, por que a alternativa foi descartada e qual
trade-off foi aceito conscientemente.

> O critério de todas as escolhas é o mesmo: o que ajuda a garantir integridade
> de dados, resiliência sob falha e triagem em segundos. Ferramenta que não
> serve a um desses três pilares não entra.

---

## 1. FastAPI

| | |
| --- | --- |
| **Resolve** | Camada HTTP com validação declarativa, injeção de dependência e OpenAPI 3.1 gerado do código. `/docs` sai pronto, sem documento paralelo que desatualiza. |
| **Alternativa** | Flask, Django REST Framework |
| **Por que não** | Flask exigiria montar validação, serialização e documentação à mão — três superfícies de erro para um case com prazo curto. DRF traz ORM, admin e *settings* acoplados; usar só a camada de API nele significa carregar um framework inteiro para usá-lo parcialmente. |
| **Trade-off aceito** | FastAPI é um framework enxuto: não traz administração, autenticação nem ORM. Essa ausência é a razão da clareza do projeto, e também significa que cada peça precisa ser escolhida e justificada — o que é exatamente o que este documento faz. |

O `async` importa neste projeto por causa do SSE: manter uma conexão aberta por
muito tempo em um worker síncrono consumiria uma *thread* do pool por cliente
conectado.

## 2. Pydantic v2

| | |
| --- | --- |
| **Resolve** | Validação, coerção e documentação do contrato em uma única declaração. É a primeira das três camadas de defesa em profundidade. |
| **Alternativa** | `dataclasses` validadas manualmente, `marshmallow`, `attrs` |
| **Por que não** | Validação manual em `dataclass` espalha `if` pela rota, e o erro sai como `500` em vez de `422`. `marshmallow` exige schema e validador separados do tipo, duplicando a definição do contrato. |
| **Trade-off aceito** | O núcleo do Pydantic v2 é compilado em Rust, o que adiciona uma dependência binária à instalação. Em troca, a validação deixa de ser um gargalo de latência e o OpenAPI é derivado dos mesmos tipos que validam a entrada. |

A validação de **formato** fica aqui; a validação de **regra de negócio** fica
na camada de domínio. Separar as duas é o que permite que a máquina de estados
seja testada sem HTTP.

## 3. SQLAlchemy 2.0

| | |
| --- | --- |
| **Resolve** | Camada de acesso a dados com tipagem, sessão e transação explícitas — e, sobretudo, a possibilidade de emitir o `UPDATE ... WHERE version = :expected` como uma instrução única. |
| **Alternativa** | ORM "mágico" que busca e salva objetos implicitamente; SQL cru com driver direto |
| **Por que não** | O ORM implícito é o que produz o antipadrão `SELECT` + `if` + `UPDATE` deste projeto precisa evitar: ele torna natural ler para a memória e gravar depois. SQL cru com driver direto resolveria o CAS e perderia mapeamento, migração e tipagem. |
| **Trade-off aceito** | Exige disciplina: a regra é que toda atualização condicional seja expressa como `UPDATE` com predicado, nunca como mutação de objeto em memória seguida de `commit`. Isso é verificado em revisão de código e pelo teste de concorrência. |

### 3.1 `expire_on_commit=False` e o custo de sessões longas

A sessão é curta: abre por requisição, comita e fecha. Sessão longa significaria
transação aberta durante a *serialização da resposta* — o que, sob concorrência,
segura conexão do pool sem necessidade.

## 4. Alembic

| | |
| --- | --- |
| **Resolve** | Versionamento do schema com migrações revisáveis e reversíveis, e um caminho explícito de `upgrade head` no deploy. |
| **Alternativa** | `Base.metadata.create_all()` na subida da aplicação |
| **Por que não** | `create_all` não versiona nada: não altera tabelas existentes, não registra o que foi aplicado e não permite reproduzir o schema de um ambiente. Em um projeto com índice composto e coluna de versão, isso deixa de ser conveniência e passa a ser risco. |
| **Trade-off aceito** | Toda mudança de modelo exige uma migração escrita e revisada — trabalho manual que `create_all` dispensaria. Em troca, o schema do ambiente publicado é reproduzível e auditável. |

## 5. PostgreSQL

| | |
| --- | --- |
| **Resolve** | O comportamento de produção: transações reais, MVCC, `UPDATE` condicional atômico sob concorrência, `statement_timeout` e índice `GIN` para busca textual. |
| **Alternativa** | JSON estruturado em arquivo ou em coluna sem transação; MySQL |
| **Por que não** | JSON não oferece lock otimista confiável: sem transação e sem `UPDATE` condicional atômico, a garantia do Pilar 1 não existe. MySQL atenderia, sem os índices de texto completo tão diretos nem o ecossistema gerenciado serverless usado no deploy. |
| **Trade-off aceito** | Exige um serviço gerenciado (Neon) e uma string de conexão com SSL. O ganho é a possibilidade de **provar** o comportamento de concorrência, e não apenas descrevê-lo. |

## 6. SQLite (desenvolvimento)

| | |
| --- | --- |
| **Resolve** | Zero fricção de setup: clonar, instalar, criar o banco e rodar, sem container e sem serviço externo. |
| **Alternativa** | Exigir PostgreSQL local desde o primeiro passo |
| **Por que não** | O ambiente de desenvolvimento deste case não tem Docker instalado. Obrigar um serviço externo transformaria "clonar e rodar" em "instalar e configurar", e o custo recairia sobre quem avalia o repositório. |
| **Trade-off aceito** | SQLite **não é equivalente** ao PostgreSQL. Ele serializa escritas e não tem `GIN`. Por isso os testes de concorrência rodam contra PostgreSQL quando disponível e usam SQLite em arquivo com `WAL` e `busy_timeout` como substituto declarado. A diferença está documentada em [`07-testes.md`](07-testes.md) em vez de escondida. |

## 7. React 18

| | |
| --- | --- |
| **Resolve** | A interface da triagem: lista longa que atualiza por partes, atualização otimista com rollback, e um ecossistema maduro para virtualização e *data fetching*. |
| **Alternativa** | Svelte, Vue, ou renderização no servidor com HTMX |
| **Por que não** | Svelte e Vue atenderiam bem; a escolha por React é de **ecossistema**: TanStack Query, TanStack Virtual e Radix têm integração de primeira linha em React, e esses três são exatamente as peças dos pilares de resiliência e performance. |
| **Trade-off aceito** | Mais código por componente do que Svelte e um bundle maior. Compensado pela virtualização e por um `React.memo` por linha com comparação por `version`. |

## 8. TypeScript em modo `strict`

| | |
| --- | --- |
| **Resolve** | O contrato da API vira erro de compilação. `noUncheckedIndexedAccess` e `strict` pegam o `undefined` que apareceria em produção depois de um filtro. |
| **Alternativa** | JavaScript com JSDoc; TypeScript sem `strict` |
| **Por que não** | Sem `strict`, o `any` implícito dissolve justamente a garantia que motivou adotar TypeScript. JavaScript com JSDoc é viável, e mais frágil em refatoração de contrato — que é o tipo de mudança constante neste projeto. |
| **Trade-off aceito** | Mais anotações e algum atrito ao integrar bibliotecas cujos tipos são incompletos. Em contrapartida, `tsc --noEmit` roda na CI e um campo removido da API quebra o build em vez de aparecer como texto `undefined` na tela. |

## 9. Vite

| | |
| --- | --- |
| **Resolve** | Servidor de desenvolvimento com HMR praticamente instantâneo e build de produção enxuto. |
| **Alternativa** | Next.js; Create React App |
| **Por que não** | O case pede uma SPA que consome uma API separada. Next.js traria renderização no servidor, roteamento por arquivos e um modelo de deploy que acoplaria front e back — complexidade que não paga por si aqui. CRA está obsoleto no ecossistema. |
| **Trade-off aceito** | Sem renderização no servidor: a primeira carga depende do JavaScript. Em uma aplicação interna, com a analista usando a mesma aba durante todo o plantão, o custo é irrelevante. |

## 10. Tailwind CSS

| | |
| --- | --- |
| **Resolve** | Tokens de design expressos como configuração, tema escuro por classe e nenhum CSS morto no bundle. |
| **Alternativa** | CSS Modules, styled-components, MUI/Chakra |
| **Por que não** | CSS Modules dispersa a decisão visual por muitos arquivos sem um ponto único de tokens. CSS-in-JS adiciona custo de runtime em uma lista que precisa rolar a 60fps. MUI e Chakra trazem uma identidade visual própria que teria de ser inteiramente sobrescrita para chegar à hierarquia de severidade do produto. |
| **Trade-off aceito** | Classes longas no JSX. Compensado por componentes que encapsulam as variações (`CriticalityBadge`, `StatusBadge`) em vez de repetir `className` pela aplicação. |

## 11. shadcn/ui sobre Radix

| | |
| --- | --- |
| **Resolve** | Diálogo com foco preso, `Select` navegável por teclado, `Popover` e `Tooltip` com ARIA correto — a base de acessibilidade exigida pelos critérios, sem escrever do zero. |
| **Alternativa** | MUI, Chakra, Ant Design, ou componentes próprios |
| **Por que não** | Bibliotecas completas impõem estrutura e estilo, e sobrescrevê-las custa mais do que construir em cima do Radix. Componentes próprios significariam reimplementar foco, teclado e ARIA — onde os erros de acessibilidade se concentram. |
| **Trade-off aceito** | O código dos componentes vive no repositório e é de responsabilidade do projeto, incluindo suas atualizações. Em troca, não há "caixa preta": o comportamento de foco do modal de conflito é legível e ajustável. |

## 12. TanStack Query

| | |
| --- | --- |
| **Resolve** | Retry, cache com `staleTime`, `keepPreviousData`, mutação otimista com `onMutate`/`onError`/`onSettled` e rollback — os critérios do Pilar 2 resolvidos por configuração. |
| **Alternativa** | Redux Toolkit Query, SWR, `fetch` em `useEffect` |
| **Por que não** | Redux Toolkit exigiria *slices*, *thunks* e *reducers* para chegar ao mesmo lugar — muito código para um problema que é de cache de servidor. SWR cobre leitura muito bem e é menos completo em mutação otimista e invalidação encadeada. `fetch` em `useEffect` reintroduz manualmente estado de carregamento, corrida de requisições e cancelamento. |
| **Trade-off aceito** | Uma dependência grande e um modelo mental próprio. Em troca, o tratamento do `409` com rollback é uma função de dez linhas, e não uma máquina de estados escrita à mão. |

## 13. TanStack Virtual

| | |
| --- | --- |
| **Resolve** | Renderizar cerca de 20 linhas em vez de 100 ou mais. É o que sustenta a demonstração de performance com o seed de 120 incidentes. |
| **Alternativa** | Renderizar toda a lista; `react-window` |
| **Por que não** | Renderizar tudo mantém milhares de nós no DOM e degrada o scroll — exatamente o que o critério "prioriza em milissegundos" avalia. `react-window` é estável e mais simples, com menos flexibilidade para altura variável de linha, que é necessária no modo confortável. |
| **Trade-off aceito** | Lista virtualizada complica busca no navegador (`Ctrl+F` só encontra o que está montado) e exige altura previsível por linha. O modo compacto e a busca interna com debounce cobrem o caso de uso real. |

## 14. Zustand

| | |
| --- | --- |
| **Resolve** | Estado de UI que não vem do servidor: tema, densidade, filtros efêmeros e estado da command palette. |
| **Alternativa** | Context API, Redux |
| **Por que não** | Context API propaga re-render para toda a subárvore a cada mudança: trocar a densidade re-renderizaria a lista inteira. Redux é a resposta errada para estado local de interface. |
| **Trade-off aceito** | Uma dependência pequena a mais e a decisão de onde guardar cada estado, que precisa ser explícita. A regra adotada é: **estado de servidor vai para o TanStack Query, estado de UI vai para o Zustand**. Filtros vivem na URL, que é a fonte de verdade para o compartilhamento de link. |

## 15. Zod

| | |
| --- | --- |
| **Resolve** | Validação em tempo de execução das respostas da API e do formulário de novo incidente, com tipos derivados do schema. |
| **Alternativa** | Confiar no tipo TypeScript gerado do OpenAPI; `yup` |
| **Por que não** | Tipo de TypeScript não existe em runtime: uma resposta fora do contrato passa pela compilação e quebra a renderização. `yup` é voltado a formulários e menos fluente para derivar tipos. |
| **Trade-off aceito** | Duplicação parcial entre o schema do backend (Pydantic) e o do frontend (Zod), já que não há geração automática de código nesta entrega. A duplicação é aceita porque o consumo do OpenAPI fica no roadmap, e ter o contrato validado nos dois lados é preferível a não ter validação. |

## 16. Vitest

| | |
| --- | --- |
| **Resolve** | Testes de componente e de hook na mesma configuração e no mesmo pipeline do Vite, com mocks de API via MSW. |
| **Alternativa** | Jest |
| **Por que não** | Jest exige configuração paralela de transformação e não compartilha o pipeline do Vite, o que produz divergência entre o ambiente de teste e o de desenvolvimento. |
| **Trade-off aceito** | Ecossistema menor e alguns problemas de compatibilidade com bibliotecas antigas. Em troca, um único `vite.config` governa dev, build e teste. |

## 17. Ruff

| | |
| --- | --- |
| **Resolve** | Lint e formatação do backend com um único binário e execução praticamente instantânea, o que torna viável rodá-lo no `pre-commit` e na CI. |
| **Alternativa** | flake8 + isort + black (+ plugins) |
| **Por que não** | Quatro ferramentas, quatro configurações e quatro execuções para fazer o que uma faz. A lentidão relativa é o que leva a equipe a deixar o lint para a CI, e não para o momento da edição. |
| **Trade-off aceito** | Uma ferramenta mais nova, com regras próprias em evolução. Em troca, o `pyproject.toml` fica com uma seção de lint em vez de quatro arquivos de configuração. |

## 18. mypy em modo `strict`

| | |
| --- | --- |
| **Resolve** | Garante que as anotações de tipo sejam reais. Em `strict`, uma anotação errada é um erro, e não um comentário decorativo. |
| **Alternativa** | Pyright, ou não usar verificação de tipos |
| **Por que não** | Pyright é excelente e mais rápido; mypy é o padrão do ecossistema Python para bibliotecas e tem o *plugin* oficial do Pydantic, que faz o tipo derivado do modelo ser entendido corretamente. Não verificar tipos em um projeto que usa `str, Enum` e schemas derivados deixa o contrato do domínio sem garantia. |
| **Trade-off aceito** | Alguns `# type: ignore` pontuais em integrações com bibliotecas de tipagem incompleta, todos com `warn_unused_ignores` ligado para que não se acumulem. |

## 19. Husky e lint-staged

| | |
| --- | --- |
| **Resolve** | Impede que código fora do padrão entre no histórico: o `pre-commit` formata apenas os arquivos alterados e o `commit-msg` valida a mensagem. |
| **Alternativa** | Deixar toda a verificação para a CI |
| **Por que não** | A CI reprova depois do push, quando corrigir já exige um commit adicional — e o histórico fica com commits de correção de lint. O hook resolve no momento em que o custo é zero. |
| **Trade-off aceito** | Hooks são locais e podem ser ignorados com `--no-verify`. Como o mesmo conjunto roda na CI, ignorar o hook não contorna a verificação: apenas transfere o momento em que ela acontece. |

## 20. Conventional Commits

| | |
| --- | --- |
| **Resolve** | Histórico legível por pessoa e por máquina, com o tipo do commit determinando a versão no SemVer e o `CHANGELOG` sendo derivável dos commits. |
| **Alternativa** | Mensagens livres |
| **Por que não** | Mensagem livre não permite gerar changelog, não permite automatizar versão e, no contexto deste case, não demonstra processo — que é um critério explícito de avaliação. |
| **Trade-off aceito** | Um padrão a memorizar e uma restrição de forma de 72 caracteres no cabeçalho. `pnpm commit` oferece o assistente interativo para quem não lembra os tipos. |

---

## 21. Trade-offs que eu aceito conscientemente

Esta seção existe porque escolha sem trade-off declarado é escolha não
compreendida. Os custos abaixo são reais e foram assumidos de propósito.

### 21.1 SQLite em desenvolvimento não é PostgreSQL

O banco local não tem o mesmo comportamento de concorrência do de produção. Um
bloqueio que aparece em SQLite pode não aparecer em Postgres, e vice-versa. A
mitigação é rodar a suíte de concorrência contra PostgreSQL quando ele existe,
e documentar a diferença em vez de fingir equivalência.

### 21.2 Duplicação do contrato entre Pydantic e Zod

O contrato é descrito duas vezes — uma no backend, outra no frontend — porque
não há geração automática de tipos nesta entrega. O custo é manter os dois em
sincronia; o benefício é que o front valida em runtime. A geração a partir do
OpenAPI é a evolução natural e está no roadmap.

### 21.3 Sem autenticação real

A autoria das ações é um `analyst_name` vindo do cliente, o que significa que
ela **não é confiável**. É adequado para um ambiente de demonstração e
inaceitável para produção. Está declarado no README, no próprio ADR e aqui,
porque um limite não declarado é um defeito.

### 21.4 Otimista em vez de pessimista significa mais conflitos visíveis

Com optimistic locking, a segunda tentativa sempre chega ao banco e sempre
custa uma requisição para descobrir o conflito. Em um cenário de conflitos
muito frequentes, isso seria desperdício. Na central de resposta a incidentes,
conflito é exceção, não regra — e a decisão de mostrar o conflito à analista é
parte do produto, não um efeito colateral.

### 21.5 Retry sem `Idempotency-Key` não existe

A política de mutação sem chave de idempotência é devolver `503` e não repetir,
o que reduz a taxa de sucesso percebida em redes instáveis em troca de nunca
duplicar ou reaplicar uma decisão humana. É um trade-off de disponibilidade por
integridade, e é o lado correto para este domínio.

### 21.6 Virtualização prejudica a busca nativa do navegador

Com a lista virtualizada, `Ctrl+F` não encontra linhas que não estão montadas.
A busca interna com debounce é a resposta do produto, e a interface orienta para
ela com o atalho `/`. Ainda assim, é uma limitação real da técnica.

### 21.7 Sem renderização no servidor

O primeiro carregamento depende do JavaScript e não há HTML pronto para
indexação. Para uma aplicação interna de operação, é um custo irrelevante — e
evita a complexidade de um framework com SSR e um modelo de deploy acoplado.

### 21.8 Cold start do plano gratuito

A hospedagem escolhida suspende o serviço por inatividade. É um defeito de
experiência do provedor, e não da aplicação, mas a analista sente de qualquer
forma. A mitigação é aquecer o serviço antes do uso e manter o timeout do
cliente compatível, com o comportamento declarado na documentação de deploy.

### 21.9 Cobertura de 80% como piso, não como meta

O portão de cobertura garante que nenhuma área fique completamente sem teste.
Ele não garante qualidade de asserção: é possível alcançar 80% com testes que
só verificam `status_code == 200`. O que sustenta o Pilar 1 é o teste de
concorrência, e é por isso que ele existe separado e é citado explicitamente
onde importa.
