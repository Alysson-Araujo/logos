<#
.SYNOPSIS
    Cria a estrutura completa do projeto Logos no GitHub.

.DESCRIPTION
    Cria labels, milestones e as 72 issues do backlog definido na secao 13 do
    PLANO-LOGOS.md. O script e idempotente: labels usam --force, milestones e
    issues sao verificados antes de criar.

.EXAMPLE
    pwsh -File .\scripts\github-bootstrap.ps1
    pwsh -File .\scripts\github-bootstrap.ps1 -SkipIssues

.NOTES
    No Windows, a politica de execucao pode bloquear o script com a mensagem
    "nao esta assinado digitalmente". Nesse caso rode liberando apenas para
    esta execucao, sem alterar a configuracao permanente da maquina:

        powershell -ExecutionPolicy Bypass -File .\scripts\github-bootstrap.ps1

    O arquivo precisa estar salvo em UTF-8 COM BOM para que o Windows
    PowerShell 5.1 leia corretamente os acentos dos milestones.
#>
[CmdletBinding()]
param(
    [string]$Repo = 'Alysson-Araujo/logos',
    [switch]$SkipLabels,
    [switch]$SkipMilestones,
    [switch]$SkipIssues
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------------- #
# Verificacoes iniciais
# --------------------------------------------------------------------------- #
Write-Host '==> Verificando autenticacao no GitHub CLI' -ForegroundColor Cyan
gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'GitHub CLI nao autenticado. Rode: gh auth login'
}

Write-Host "==> Repositorio alvo: $Repo" -ForegroundColor Cyan
gh repo view $Repo --json name 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Repositorio $Repo nao encontrado. Crie-o antes: gh repo create $Repo --public --source . --push"
}

# --------------------------------------------------------------------------- #
# Labels
# --------------------------------------------------------------------------- #
$Labels = @(
    # Tipo
    'type:feat|0e8a16|Nova funcionalidade'
    'type:fix|d73a4a|Correção de defeito'
    'type:refactor|5319e7|Reestruturação sem mudar comportamento'
    'type:test|1d76db|Testes'
    'type:docs|0075ca|Documentação'
    'type:chore|cfd3d7|Build, dependências e configuração'
    'type:perf|fbca04|Performance'

    # Área
    'area:api|0052cc|Backend e API'
    'area:web|20476e|Frontend'
    'area:db|6f42c1|Banco de dados e migrações'
    'area:ux|e99695|Interface e experiência do usuário'
    'area:ci|24292e|CI/CD e automação'
    'area:infra|bfd4f2|Deploy e infraestrutura'

    # Prioridade
    'prio:critical|b60205|Bloqueia a entrega'
    'prio:high|d93f0b|Alta prioridade'
    'prio:medium|fbca04|Prioridade média'
    'prio:low|0e8a16|Baixa prioridade'

    # Esforço
    'size:XS|c2e0c6|Menos de 1 hora'
    'size:S|c2e0c6|Até meio dia'
    'size:M|fef2c0|Até 1 dia'
    'size:L|f9d0c4|De 2 a 3 dias'
    'size:XL|e11d21|Mais de 3 dias'

    # Estado
    'status:blocked|b60205|Bloqueado por dependência'
    'status:needs-review|fbca04|Aguardando revisão'

    # Marcadores de destaque na avaliação
    'diferencial|7057ff|Item que soma pontos extras'
    'documentacao|1d76db|Entrega de documentação'
    'resiliencia|0e8a16|Concorrência, retry e tolerância a falha'
    'performance|fbca04|Otimização mensurável'
    'pos-mvp|c5def5|Fora do caminho crítico dos 5 dias'
)

if (-not $SkipLabels) {
    Write-Host "==> Criando $($Labels.Count) labels" -ForegroundColor Cyan
    foreach ($entrada in $Labels) {
        $partes = $entrada -split '\|'
        gh label create $partes[0] --repo $Repo --color $partes[1] --description $partes[2] --force | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning "Falha ao criar label $($partes[0])" }
    }
    Write-Host '    Labels criadas.' -ForegroundColor Green
}

# --------------------------------------------------------------------------- #
# Milestones
# --------------------------------------------------------------------------- #
$Milestones = @(
    'M0 — Fundação'
    'M1 — Backend Core'
    'M2 — Concorrência e Resiliência'
    'M3 — Frontend UX'
    'M4 — Qualidade'
    'M5 — Deploy e Entrega'
    'M6 — Backlog pós-MVP'
)

if (-not $SkipMilestones) {
    Write-Host "==> Criando $($Milestones.Count) milestones" -ForegroundColor Cyan
    $existentes = @()
    try {
        $existentes = (gh api "repos/$Repo/milestones?state=all&per_page=100" --jq '.[].title') -split "`n"
    }
    catch {
        Write-Warning 'Nao foi possivel listar milestones existentes; tentando criar todos.'
    }

    foreach ($titulo in $Milestones) {
        if ($existentes -contains $titulo) {
            Write-Host "    [ok] $titulo ja existe." -ForegroundColor DarkGray
            continue
        }
        gh api "repos/$Repo/milestones" -f title="$titulo" | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warning "Falha ao criar milestone $titulo" }
        else { Write-Host "    [novo] $titulo" -ForegroundColor Green }
    }
}

# --------------------------------------------------------------------------- #
# Backlog
#
# Formato: numero | titulo | labels | milestone | contexto | criterios (;)
# --------------------------------------------------------------------------- #
$Backlog = @'
1|chore(repo): inicia monorepo com workspaces backend e frontend|type:chore,area:ci,size:S|M0 — Fundação|Criar a estrutura base do monorepo, com o frontend como workspace pnpm e o backend Python isolado.|Estrutura backend/ frontend/ docs/ .github/ criada; pnpm install roda sem erro; git inicializado na branch main
2|chore(repo): adiciona .gitignore, .gitattributes e .editorconfig|type:chore,size:XS|M0 — Fundação|Higiene de repositorio para evitar CRLF no CI, segredos vazados e arquivos gerados versionados.|.gitattributes com eol=lf aplicado; .env e node_modules ignorados; .editorconfig respeitado pelo editor
3|chore(repo): configura husky, lint-staged e commitlint|type:chore,area:ci,size:S|M0 — Fundação|Aplicar o padrao de escrita no momento do commit, e nao na revisao.|Hooks pre-commit e commit-msg ativos; commit fora do padrao Conventional Commits e rejeitado; lint-staged formata apenas os arquivos alterados
4|chore(web): configura prettier e eslint no frontend|type:chore,area:web,size:S|M0 — Fundação|Padronizar formatacao e lint no frontend com regras de React, hooks e acessibilidade.|ESLint 9 flat config ativo; react-hooks e jsx-a11y habilitados; pnpm lint roda sem erro
5|chore(api): configura ruff e mypy no backend|type:chore,area:api,size:S|M0 — Fundação|Padronizar lint, formatacao e verificacao de tipos no backend.|ruff check e ruff format --check limpos; mypy em modo strict sem erro
6|ci: cria pipeline de lint, typecheck e testes|type:chore,area:ci,prio:high,size:M|M0 — Fundação|Impedir que codigo quebrado chegue na branch main.|Jobs de backend, frontend e validacao de commits; roda em push e em pull request; cache de dependencias configurado
7|chore(ci): adiciona templates de issue e pull request|type:chore,area:ci,documentacao|M0 — Fundação|Padronizar o relato de defeitos, propostas e a descricao de pull requests.|Tres templates de issue em YAML; template de PR com checklist de codigo, produto e processo; CODEOWNERS definido
8|docs: cria .env.example e guia de setup local|type:docs,documentacao,size:S|M0 — Fundação|Garantir que qualquer pessoa consiga rodar o projeto do zero.|.env.example presente em backend e frontend; passo a passo validado em pasta limpa
9|feat(api): configura FastAPI, settings e lifespan|type:feat,area:api,size:S|M1 — Backend Core|Bootstrap da aplicacao com configuracao por ambiente e ciclo de vida controlado.|App sobe e expoe /docs; CORS lido de variavel de ambiente; lifespan abre e fecha o pool de conexoes
10|feat(db): define modelos SQLAlchemy e enums do dominio|type:feat,area:db,size:M|M1 — Backend Core|Modelar o incidente e os enums de categoria, criticidade e status.|Cinco categorias, tres criticidades e quatro status como enums; coluna version presente desde a primeira migracao; soft delete via deleted_at
11|feat(db): configura Alembic e migracao inicial|type:feat,area:db,size:S|M1 — Backend Core|Versionar o esquema do banco em vez de criar tabelas manualmente.|Alembic configurado; migracao inicial gera todas as tabelas e indices; upgrade e downgrade funcionam
12|feat(api): implementa schemas Pydantic com validacoes|type:feat,area:api,size:M|M1 — Backend Core|Transformar o requisito de validacao em contrato declarativo.|Title de 3 a 120 caracteres sem HTML; placa normalizada em maiusculas com regex; latitude e longitude em faixa valida; entrada invalida retorna 422 e nunca 500
13|feat(api): cria camada de repositorio de incidentes|type:feat,area:api,size:M|M1 — Backend Core|Isolar o acesso a dados da regra de negocio.|Repositorio com criar, buscar por id, listar e atualizar; nenhuma consulta SQL escrita fora desta camada; indices da secao 6.2 aplicados
14|feat(api): implementa POST /incidents com codigo legivel|type:feat,area:api,prio:high,size:M|M1 — Backend Core|Permitir o registro de um incidente com identificador util para o radio da operacao.|Retorna 201 com Location; gera code no formato INC-ANO-NUMERO; SLA derivado da criticidade; incidente sempre inicia em ABERTO
15|feat(api): implementa GET /incidents/{id} com ETag|type:feat,area:api,size:S|M1 — Backend Core|Permitir a leitura de um incidente e a deteccao de alteracoes pelo cliente.|Retorna 200 e 404 conforme o caso; header ETag com o valor da version; soft deleted retorna 404
16|feat(api): implementa filtros por status, criticidade e categoria|type:feat,area:api,prio:high,size:M|M1 — Backend Core|Atender o requisito de gestao por excecao, permitindo isolar o que importa.|Filtros combinaveis; multiplos valores por virgula; busca textual em titulo, descricao, codigo, placa e local; filtro invalido retorna 422
17|feat(db): cria seed com 120 incidentes realistas|type:feat,area:db,size:S|M1 — Backend Core|Popular o ambiente para demonstrar a tela com volume realista.|120 incidentes em pt-BR; rodovias e placas realistas; created_at distribuido nas ultimas 72 horas; execucao idempotente
18|feat(api): padroniza respostas e erros da API|type:feat,area:api,prio:high,size:S|M1 — Backend Core|Unificar o envelope de erro para que o frontend trate falhas de forma previsivel.|Envelope unico com code, message, details, requestId e timestamp; handlers globais para validacao e excecoes de dominio; o formato padrao do FastAPI nao vaza
19|feat(api): implementa maquina de estados com transicoes validadas|type:feat,area:api,prio:critical,size:M|M2 — Concorrência e Resiliência|Garantir que apenas transicoes de status validas sejam aceitas.|Regra implementada como funcao pura e testavel; FECHADO e terminal; transicao invalida retorna 422 com allowed listando as opcoes validas
20|feat(api): adiciona lock otimista com version e If-Match|type:feat,area:api,prio:critical,resiliencia,size:L|M2 — Concorrência e Resiliência|Impedir que dois analistas sobrescrevam o mesmo incidente sem perceber. Este e o item de maior peso do case.|Atualizacao de status executada como UPDATE condicional por version, sem leitura previa em Python; rowcount zero resulta em 409 com a representacao atual; suporta multiplos workers
21|feat(api): implementa 409 Conflict com representacao atual|type:feat,area:api,prio:critical,resiliencia,size:S|M2 — Concorrência e Resiliência|Dar ao frontend informacao suficiente para mostrar o conflito ao analista.|Corpo do erro traz code VERSION_CONFLICT e details.current com o incidente atual; If-Match malformado retorna 412
22|feat(api): adiciona Idempotency-Key nas mutacoes|type:feat,area:api,resiliencia,size:M|M2 — Concorrência e Resiliência|Tornar seguro o reenvio de uma requisicao quando a rede oscila.|Chave armazenada com hash do corpo e resposta; repeticao com mesmo corpo devolve a resposta original; corpo diferente retorna 409
23|feat(api): cria endpoint POST /incidents/{id}/status|type:feat,area:api,size:M|M2 — Concorrência e Resiliência|Expor a transicao de status como operacao de dominio explicita.|Valida transicao, exige resolution_notes em FECHADO e INCONCLUSIVO e aplica o lock otimista; preenche closed_at e assigned_analyst
24|feat(api): registra timeline de auditoria por incidente|type:feat,area:api,size:M|M6 — Backlog pós-MVP|Registrar quem mudou o que e quando, para justificar decisoes depois.|Tabela de eventos alimentada a cada transicao; endpoint de leitura da timeline; pos-MVP por gestao de prazo
25|feat(api): exige resolution_notes em FECHADO e INCONCLUSIVO|type:feat,area:api,size:S|M2 — Concorrência e Resiliência|Forcar o registro do motivo do encerramento, evitando fechamento sem justificativa.|Minimo de 10 caracteres; ausencia retorna 422 com code RESOLUTION_NOTES_REQUIRED; validado no schema e no servico
26|test(api): cobre corrida de status com ThreadPoolExecutor|type:test,area:api,prio:critical,resiliencia,size:M|M2 — Concorrência e Resiliência|Provar, e nao apenas afirmar, que o lock otimista funciona sob concorrencia real.|Dez threads disparam a mesma transicao com a mesma versao; exatamente uma recebe 200 e nove recebem 409; roda tambem contra PostgreSQL na CI
27|feat(api): adiciona retry com backoff exponencial e jitter|type:feat,area:api,resiliencia,size:M|M2 — Concorrência e Resiliência|Sobreviver a falhas transitorias de banco sem derrubar a requisicao.|Tres tentativas com espera 1s, 2s e 4s mais jitter; aplicado apenas a operacoes idempotentes; nao reexecuta escrita sem Idempotency-Key
28|feat(db): configura timeouts de pool e statement|type:feat,area:db,resiliencia,size:S|M2 — Concorrência e Resiliência|Evitar que uma consulta lenta consuma um worker indefinidamente.|pool_pre_ping, pool_size, max_overflow e pool_recycle no PostgreSQL; statement_timeout e busy_timeout no SQLite
29|feat(api): implementa circuit breaker com 503 e Retry-After|type:feat,area:api,resiliencia,size:M|M2 — Concorrência e Resiliência|Falhar rapido em vez de enfileirar requisicoes condenadas quando o banco esta degradado.|Abre apos N falhas consecutivas; responde 503 com Retry-After; fecha automaticamente apos periodo de teste
30|feat(api): adiciona cache TTL com stale-while-revalidate|type:feat,area:api,resiliencia,size:M|M6 — Backlog pós-MVP|Servir dado levemente antigo em vez de tela de erro durante degradacao.|Cache na listagem com TTL curto; revalidacao em segundo plano; pos-MVP porque retry e circuit breaker ja cobrem o criterio
31|feat(api): implementa paginacao por cursor|type:feat,area:api,performance,size:M|M2 — Concorrência e Resiliência|Manter a paginacao estavel numa lista que muda em tempo real.|Cursor em base64 com score e id; keyset pagination sem OFFSET; hasNextPage e nextCursor corretos; cursor invalido retorna 400
32|feat(api): adiciona indices e calculo de priority score|type:feat,area:db,performance,size:M|M2 — Concorrência e Resiliência|Ordenar os incidentes por prioridade real, de forma deterministica e explicavel.|Formula impacto mais urgencia mais aging mais pressao de SLA; calculado no servidor e persistido; indices compostos criados; coberto por teste unitario
33|feat(api): adiciona rate limit, CORS e headers de seguranca|type:feat,area:api,prio:high,size:S|M2 — Concorrência e Resiliência|Cobrir a seguranca basica exigida na demonstracao do case.|CORS restrito as origens configuradas; rate limit por IP com Retry-After; cabecalhos X-Content-Type-Options e Referrer-Policy
34|feat(web): inicializa Vite, React 18 e TypeScript strict|type:feat,area:web,size:S|M3 — Frontend UX|Base do frontend com tipagem estrita desde o primeiro commit.|Projeto sobe com pnpm dev; TypeScript strict com noUncheckedIndexedAccess; alias @ apontando para src
35|feat(web): configura Tailwind e tokens de design|type:feat,area:ux,size:M|M3 — Frontend UX|Centralizar cores, espacamento, tipografia e raios em tokens.|Tokens em CSS custom properties com bloco dark; nenhum valor de cor hardcoded em componente; escala de espacamento em base 4px
36|feat(web): implementa tema claro e escuro persistido|type:feat,area:ux,diferencial,size:S|M3 — Frontend UX|Atender um dos diferenciais de usabilidade citados no briefing.|Alternancia funcional; preferencia persistida em localStorage; respeita prefers-color-scheme no primeiro acesso; sem flash de tema errado
37|feat(web): cria AppShell com header, navegacao e responsividade|type:feat,area:ux,size:M|M3 — Frontend UX|Dar estrutura visual a aplicacao, explicando o proposito ja na primeira tela.|Header com identidade e alternador de tema; layout responsivo; area principal sem excesso de elementos
38|feat(web): cria componentes base acessiveis|type:feat,area:ux,size:L|M3 — Frontend UX|Ter uma base de UI acessivel e consistente, sem depender de biblioteca caixa preta.|Button, Card, Badge, Dialog, Drawer, Select, Input, Tooltip, Skeleton e Toast; foco visivel; navegacao por teclado; ARIA correto
39|feat(web): implementa cliente HTTP com timeout, retry e idempotencia|type:feat,area:web,resiliencia,size:M|M3 — Frontend UX|Tratar rede instavel como caso normal, e nao como excecao.|AbortController com timeout de 10s em leitura e 15s em escrita; retry com backoff e jitter apenas em GET; mutacao sem retry automatico; Idempotency-Key gerada no momento da acao
40|feat(web): configura TanStack Query com politica de cache|type:feat,area:web,size:S|M3 — Frontend UX|Centralizar a politica de cache, retry e revalidacao.|staleTime de 30s; networkMode offlineFirst; refetchOnWindowFocus desligado; rolagem de erro padronizada
41|feat(web): cria tipos e schemas Zod do contrato da API|type:feat,area:web,size:S|M3 — Frontend UX|Impedir que o frontend confie cegamente no JSON recebido.|Tipos espelhando o contrato; validacao em runtime com Zod; falha de contrato gera erro tratado, nao undefined na tela
42|feat(web): implementa KPIs do topo com contagem por status|type:feat,area:ux,size:S|M3 — Frontend UX|Responder em tres segundos qual e a situacao geral da operacao.|Quatro cartoes com contagem por status; contador de SLA estourando em destaque; valores atualizados junto com a lista
43|feat(web): cria lista de incidentes com virtualizacao|type:feat,area:web,performance,size:L|M3 — Frontend UX|Exibir mais de cem incidentes com rolagem fluida.|Virtualizacao com tanstack/react-virtual; cerca de 20 nos no DOM para 120 itens; scroll a 60fps; linha memorizada por version
44|feat(web): implementa badges de criticidade e status acessiveis|type:feat,area:ux,size:S|M3 — Frontend UX|Permitir a leitura imediata da severidade sem depender de cor.|Cor mais icone mais forma mais rotulo textual; contraste WCAG AA nos dois temas; testado para nao depender apenas de cor
45|feat(web): implementa barra de filtros com estado na URL|type:feat,area:web,prio:high,size:L|M3 — Frontend UX|Permitir isolar o que importa e compartilhar a visao com um colega.|Filtros de criticidade, categoria e status; estado serializado na query string; link compartilhavel; limpar filtros em um clique
46|feat(web): adiciona busca com debounce e keepPreviousData|type:feat,area:web,size:S|M3 — Frontend UX|Buscar sem disparar requisicao a cada tecla nem piscar a tela.|Debounce de 300ms; keepPreviousData evita estado vazio durante a busca; resultados coerentes com o filtro ativo
47|feat(web): implementa ordenacao por prioridade e SLA timer|type:feat,area:ux,size:M|M3 — Frontend UX|Traduzir o priority score em algo que o olho entende na hora.|Ordenacao por prioridade como padrao; timer com tabular-nums; mudanca progressiva de cor conforme o SLA se aproxima e estoura
48|feat(web): implementa scroll infinito com cursor|type:feat,area:web,size:M|M3 — Frontend UX|Carregar mais incidentes sem sobrecarregar a primeira renderizacao.|useInfiniteQuery com cursor; skeleton de tres linhas ao final; sem requisicoes duplicadas durante a rolagem
49|feat(web): adiciona modo compacto e atalhos de teclado|type:feat,area:ux,diferencial,size:M|M6 — Backlog pós-MVP|Aumentar a densidade de informacao e acelerar quem usa o sistema o dia inteiro.|Atalhos j, k, Enter, barra e Esc funcionando; modo compacto persistido; o modo compacto fica pos-MVP por gestao de prazo
50|feat(web): cria drawer de detalhe do incidente|type:feat,area:ux,size:L|M3 — Frontend UX|Concentrar contexto e acao sem tirar o analista da lista.|Drawer lateral com dados, local, placa, SLA e timeline resumida; abre sem perder a posicao da lista; fecha com Esc
51|feat(web): implementa mudanca de status com atualizacao otimista|type:feat,area:web,resiliencia,size:L|M3 — Frontend UX|Fazer a interface responder na hora, mesmo com o banco ainda processando.|onMutate aplica a mudanca e guarda o snapshot; rollback em erro; onSettled invalida a query; botao com estado pendente visivel
52|feat(web): cria modal de conflito 409 com diff do servidor|type:feat,area:web,prio:critical,resiliencia,size:M|M3 — Frontend UX|Transformar o conflito de concorrencia em uma decisao informada do analista.|Modal mostra campo a campo o que foi tentado e o que esta no servidor; acoes de recarregar e descartar; aria-live assertivo
53|feat(web): implementa estados de loading, erro e vazio|type:feat,area:ux,prio:high,size:M|M3 — Frontend UX|Garantir que o usuario nunca fique na duvida se o sistema travou.|Skeleton no formato do conteudo; vazio inicial e vazio filtrado com acoes distintas; erro recuperavel com tentativa e cache antigo visivel; banner de offline
54|feat(web): adiciona deteccao de offline e fila de mutacoes|type:feat,area:web,diferencial,size:M|M6 — Backlog pós-MVP|Nao perder a acao do analista quando a conexao cai.|Banner de offline implementado; fila persistida de mutacoes em localStorage; a fila fica pos-MVP, o banner e o essencial
55|feat(web): cria formulario de novo incidente validado com Zod|type:feat,area:ux,size:M|M3 — Frontend UX|Permitir o registro de um incidente pela interface.|Campos com validacao Zod espelhando o backend; mensagem de erro por campo; sucesso cria o item e da feedback por toast
56|test(api): cobre regras, prioridade e schemas com unitarios|type:test,area:api,size:M|M4 — Qualidade|Proteger a regra de negocio com testes rapidos e isolados.|Todas as transicoes validas e invalidas cobertas; ordenacao por prioridade testada por faixa; validacao de placa, latitude e longitude
57|test(api): cobre rotas, filtros e erros com integracao|type:test,area:api,size:L|M4 — Qualidade|Verificar o contrato HTTP de ponta a ponta.|Listagem com filtros combinados; paginacao por cursor; 404, 409, 412 e 422 no envelope padrao; suíte rodando em SQLite e em PostgreSQL
58|test(web): cobre componentes e hooks criticos com Vitest|type:test,area:web,size:L|M4 — Qualidade|Provar o comportamento da interface sem depender de teste manual.|Badge de criticidade com cor, icone e texto; linha do incidente; serializacao de filtros na URL; retry do cliente HTTP; estados vazio e de erro
59|test(web): adiciona E2E dos fluxos de triagem e conflito|type:test,area:web,diferencial,size:M|M6 — Backlog pós-MVP|Validar o fluxo completo em navegador real.|Playwright cobrindo filtrar, abrir, mudar status e conflito; pos-MVP por gestao de prazo, ja que os testes de componente cobrem a logica
60|ci: adiciona cobertura, badge e checagem de bundle|type:chore,area:ci,size:S|M4 — Qualidade|Dar visibilidade objetiva da qualidade da entrega.|Cobertura minima de 80 por cento no backend; badge no README; build falha se o bundle passar do limite definido
61|feat(api): adiciona healthchecks live e ready|type:feat,area:infra,size:S|M5 — Deploy e Entrega|Permitir que a plataforma de hospedagem saiba o estado real do servico.|Live responde sem tocar o banco; ready valida a conexao e retorna 503 quando o banco esta indisponivel
62|feat(api): implementa logs estruturados com requestId|type:feat,area:infra,size:S|M5 — Deploy e Entrega|Conseguir rastrear uma requisicao especifica em producao.|Log em JSON com requestId, metodo, rota, status e duracao; requestId devolvido no header X-Request-Id e presente no envelope de erro
63|chore(infra): publica API no Render com Postgres gerenciado|type:chore,area:infra,prio:critical,size:M|M5 — Deploy e Entrega|Ter a API acessivel publicamente, sem instalacao local.|Servico no ar respondendo health ready; variaveis de ambiente configuradas; migracao e seed aplicados; CORS apontando para o frontend real
64|chore(infra): publica frontend na Vercel|type:chore,area:infra,prio:critical,size:S|M5 — Deploy e Entrega|Ter a interface acessivel publicamente, sem instalacao local.|Build de producao publicado; variavel da API configurada; aplicacao funcional em janela anonima
65|ci: cria smoke test pos-deploy do ambiente publicado|type:chore,area:ci,size:S|M5 — Deploy e Entrega|Detectar rapidamente um deploy que subiu errado.|Workflow verifica health ready apos o deploy com novas tentativas, tolerando o cold start do free tier
66|docs: escreve README raiz com setup, arquitetura e prints|type:docs,documentacao,prio:critical,size:L|M5 — Deploy e Entrega|Ser o ponto de entrada da avaliacao e explicar a solucao em cinco minutos de leitura.|Problema, solucao, prints, links, stack, decisao de arquitetura, tres pilares, setup copia e cola, variaveis de ambiente, testes e roadmap
67|docs: documenta contrato da API com exemplos e erros|type:docs,documentacao,size:M|M5 — Deploy e Entrega|Permitir que qualquer pessoa teste a API sem ler o codigo.|Tabela de endpoints com codigos; exemplos reais de requisicao e resposta; catalogo de erros; explicacao de ETag, If-Match e Idempotency-Key
68|docs: documenta concorrencia e resiliencia|type:docs,documentacao,resiliencia,size:M|M5 — Deploy e Entrega|Explicar em profundidade o item de maior peso da avaliacao.|Cenario do lost update narrado; SQL do compare-and-swap; por que nao usar lock pessimista; diagrama de sequencia do 409; camadas de resiliencia
69|docs: documenta design system e decisoes de UX|type:docs,documentacao,size:M|M5 — Deploy e Entrega|Justificar as escolhas visuais com criterio, e nao com gosto pessoal.|Tokens dos dois temas; regra de redundancia de canais e o motivo; formula do priority score com exemplo numerico; wireframes; acessibilidade
70|docs: escreve ADRs das decisoes arquiteturais|type:docs,documentacao,size:L|M5 — Deploy e Entrega|Registrar o porque de cada escolha, incluindo as alternativas descartadas.|Quatorze ADRs no formato contexto, decisao, alternativas e consequencias; cada um com trade-offs explicitos
71|docs: adiciona CONTRIBUTING e guia de git workflow|type:docs,documentacao,size:S|M5 — Deploy e Entrega|Deixar o processo de trabalho explicito e reproduzivel.|Fluxo de branch; padrao de commit com exemplos; Definition of Done; como abrir pull request
72|docs: grava e publica o video de demonstracao|type:docs,prio:critical,size:M|M5 — Deploy e Entrega|Entregar a demonstracao tecnica de ate cinco minutos exigida no case.|Video com no maximo 5 minutos; mostra integracao front e back; demonstra loading, erro e vazio; explica filtros e seguranca da API; demonstra o conflito 409 ao vivo
'@

if (-not $SkipIssues) {
    $linhas = $Backlog -split "`n" | Where-Object { $_.Trim() -ne '' }
    Write-Host "==> Criando $($linhas.Count) issues em $Repo" -ForegroundColor Cyan
    Write-Host '    Isso leva alguns minutos por causa do rate limit da API do GitHub.' -ForegroundColor DarkGray

    $existentes = @()
    try {
        $existentes = (gh issue list --repo $Repo --state all --limit 200 --json title --jq '.[].title') -split "`n"
    }
    catch {
        Write-Warning 'Nao foi possivel listar issues existentes; tentando criar todas.'
    }

    $criadas = 0
    $ignoradas = 0

    foreach ($linha in $linhas) {
        $campos = $linha -split '\|'
        if ($campos.Count -lt 6) {
            Write-Warning "Linha malformada, ignorada: $linha"
            continue
        }

        $numero = $campos[0].Trim()
        $titulo = $campos[1].Trim()
        $labels = $campos[2].Trim()
        $milestone = $campos[3].Trim()
        $contexto = $campos[4].Trim()
        $criterios = $campos[5].Trim() -split ';'

        if ($existentes -contains $titulo) {
            $ignoradas++
            continue
        }

        $checklist = ($criterios | ForEach-Object { "- [ ] $($_.Trim())" }) -join "`n"

        $corpo = @"
## Contexto

$contexto

## Criterios de aceite

$checklist

## Definition of Done

- [ ] Formatacao e lint limpos
- [ ] Tipos verificados
- [ ] Testes escritos ou atualizados, e verdes
- [ ] Estados de UI tratados (loading, erro e vazio), quando houver interface
- [ ] Sem ``console.log``, ``print()`` ou codigo comentado
- [ ] Documentacao ou ADR atualizado, se a decisao mudou
- [ ] Pull request com ``Closes #`` e CI verde

---

_Issue gerada a partir do planejamento em ``PLANO-LOGOS.md``._
"@

        $argumentos = @(
            'issue', 'create'
            '--repo', $Repo
            '--title', $titulo
            '--body', $corpo
            '--label', $labels
        )
        if ($milestone -ne '') { $argumentos += @('--milestone', $milestone) }

        gh @argumentos | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $criadas++
            Write-Host ("    [{0,2}] {1}" -f $numero, $titulo) -ForegroundColor Green
        }
        else {
            Write-Warning "Falha ao criar a issue $numero : $titulo"
        }

        Start-Sleep -Milliseconds 700
    }

    Write-Host ''
    Write-Host "==> Concluido: $criadas criadas, $ignoradas ja existiam." -ForegroundColor Cyan
    Write-Host "    Veja em: https://github.com/$Repo/issues" -ForegroundColor Cyan
}
