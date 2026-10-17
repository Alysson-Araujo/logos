# 11 · Autenticação no frontend

A tela de login e a sessão que alimenta a interface. O contrato da API está em [`docs/03`](03-api.md); aqui está o que o **frontend** faz com ele.

## Por que existe

Antes desta entrega a interface era anônima: `App.tsx` montava a triagem direto e o nome no cabeçalho era literal (`Header.tsx` — "Alysson · analista"). Duas coisas mudaram isso: o edital pede a orientação de acesso na tela inicial ou no README, e o critério de "segurança básica da API" só se sustenta se houver alguém para autenticar.

## O contrato que o frontend consome

`POST /api/v1/auth/login` devolve:

```jsonc
{
  "accessToken": "eyJhbGciOi...",
  "tokenType": "Bearer",
  "expiresIn": 28800, // segundos
  "user": { "id": "…", "email": "…", "name": "…", "role": "ANALYST", "lastLoginAt": null },
}
```

O frontend acrescenta `expiresAt` (epoch em ms, calculado no login) para decidir sozinho se a sessão ainda vale — sem uma chamada a mais e sem 401 previsível.

`POST /auth/logout` revoga o token no servidor. `GET /auth/me` existe e **não é usado**: a sessão já carrega o usuário, e uma chamada extra no boot só criaria mais um estado de erro a tratar.

## Decisões

### 1. `sessionStorage`, não `localStorage`

Está em [ADR 0015](adr/0015-sessao-no-sessionstorage.md). Resumo: a sessão é do tamanho da aba. Recarregar mantém, fechar encerra — e o frame de login não tem "lembrar-me".

### 2. O 401 do login não passa pelo interceptor

`INVALID_CREDENTIALS` é 401, como `UNAUTHENTICATED`. Se o interceptor tratasse todo 401 como sessão perdida, a tela de erro recarregaria a si mesma. A chamada de login se declara fora do caminho com `skipAuth: true`, e a exceção fica no cliente HTTP, não no componente.

### 3. Timeout próprio no login

O primeiro login de uma sessão acorda a API (o plano gratuito hiberna depois de ~15 minutos ociosos). A chamada usa **45 s** enquanto o resto do cliente segue com os 10 s/15 s padrão. E o `kind: 'timeout'` tem mensagem própria — "a API pode estar acordando" —, porque dizer "credenciais inválidas" para uma API dormindo seria mentira.

### 4. A copy do erro é do frontend, por código

A interface **não** exibe a `message` do servidor: o texto sai de `describeLoginError()`, mapeado por `code`. Assim o texto é exatamente o do frame de erro, nenhuma mensagem interna vaza para a tela, e o servidor deixa de ditar UI.

### 5. Sem router

São duas telas mutuamente exclusivas. `AuthGate` renderiza o login **ou** a aplicação, condicionado ao estado da sessão — sem dependência nova e sem estado de navegação para manter.

## Fidelidade ao Figma

Frames `Login · padrão`, `Login · erro de credencial` e `Login · carregando` (seção `Login`, nó `31:13146`).

| Elemento              | Frame                                                                        | Implementação                                                        |
| --------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| fundo                 | `color/surface` `#f5f6f8`                                                    | `bg-bg`                                                              |
| card                  | 416 px de largura                                                            | `w-[416px] max-w-full`                                               |
| respiro interno       | 32 px                                                                        | `p-8`                                                                |
| espaçamento           | 24 px                                                                        | `gap-6`                                                              |
| raio do card          | `radius/md` (10)                                                             | `rounded-md`                                                         |
| sombra                | `sombra/e3`                                                                  | `shadow-e3`                                                          |
| wordmark              | JetBrains Mono SemiBold 14/20                                                | `font-mono text-sm font-semibold`                                    |
| subtítulo             | Inter 14/20 `color/fg-muted`                                                 | `text-sm text-fg-muted`                                              |
| divisor               | 1 px `color/border`                                                          | `h-px w-full bg-border`                                              |
| rótulo de campo       | Inter Medium 14/20 `color/fg`                                                | `text-sm font-medium`                                                |
| campo                 | 36 px, raio 6, borda 1 px, padding 12                                        | `Input` (`h-9 rounded-sm border px-3`)                               |
| botão                 | `Button` primary/md, 36 px, largura cheia                                    | `variant="primary"` + `w-full`                                       |
| alerta de erro        | `color/danger-soft`, raio 6, padding 12, gap 8, texto 14 `color/danger-text` | `bg-danger-soft rounded-sm px-3 py-3 gap-2 text-sm text-danger-text` |
| caixa de demonstração | `color/surface-sunken`, raio 10, padding 12, gap 4, mono 12/16               | `bg-surface-sunken rounded-md p-3 gap-1 font-mono text-2xs`          |
| seletor de tema       | 36×36, a 32 px do topo e 44 px da direita                                    | `ThemeToggle` em `absolute right-11 top-8`                           |
| campos desabilitados  | opacidade 0,6 no carregamento                                                | `disabled:opacity-60` do `Input`                                     |

### Desvios conscientes

| O quê                              | No frame                               | Na implementação       | Por quê                                                                                                          |
| ---------------------------------- | -------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| posição vertical do card           | 210 px do topo (canvas de 900)         | centralizado (≈226 px) | a altura da tela de quem avalia não é conhecida, e o card não pode ser cortado                                   |
| ícone do botão                     | `Rows3` (três linhas, e não renderiza) | `LogIn`                | três linhas horizontais não significam "entrar"; o frame de carregamento já usava o ícone certo (`LoaderCircle`) |
| altura do alerta                   | 24 px                                  | 44 px (12 + 20 + 12)   | o frame tem o padding ligado ao token `space/3`; o autolayout é que ficou para trás                              |
| caixa alta do rótulo               | texto em maiúsculas                    | `uppercase` no CSS     | leitor de tela lê melhor a frase em caixa mista                                                                  |
| giro do `LoaderCircle`             | estático                               | `animate-spin`         | o Figma não anima                                                                                                |
| largura do card em telas estreitas | fixa em 416 px                         | `max-w-full`           | em 360 px de viewport o card não pode estourar                                                                   |

## O caminho do 401

```
requisição autenticada → 401
        │
        ├─ http.ts avisa a ponte (configureAuth)
        │
        ├─ useAuthStore.signOut('expired')  → sessionStorage limpo
        │
        ├─ queryClient.clear()              → nenhum dado da sessão anterior
        │
        └─ AuthGate volta ao login, com o aviso "Sua sessão expirou. Entre novamente."
```

## Testes

| Arquivo                                         | Cobre                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `features/auth/useAuthStore.test.ts`            | persistência na aba, token vencido, conteúdo adulterado, JSON inválido          |
| `features/auth/api.test.ts`                     | contrato da resposta, erro tipado, revogação _best effort_                      |
| `features/auth/components/LoginScreen.test.tsx` | os três estados do frame, validação local, foco no campo errado, `aria-invalid` |
| `features/auth/AuthGate.test.tsx`               | sem sessão a triagem não monta; sessão expirada devolve ao login                |
| `components/layout/Header.test.tsx`             | nome e papel vindos da sessão; "Sair" limpa aba e store                         |
| `lib/http.session.test.ts`                      | `Authorization`, dispensa do login, 401 avisando o ouvinte                      |

**Por que `api.test.ts` roda em ambiente `node`:** o `fetch` do Node (undici) recusa um `AbortSignal` criado no realm do jsdom, e o MSW roda no processo do Node — a mesma razão já registrada em `features/incidents/api/endpoints.test.ts`. Custou uma rodada de testes vermelhos para descobrir: em jsdom a chamada vaza para a rede e volta como `NETWORK_ERROR`, não como erro de credencial. O componente, por sua vez, testa contra a camada de API mockada — determinístico e sem depender de tempo.

## Limites conhecidos

- **O token é acessível por JavaScript** — ver ADR 0015.
- **Não há refresh**: vencido o TTL, a pessoa entra de novo.
- **A interface ainda não esconde ações por papel.** O `REPORTER` recebe a fila escopada da API, mas os botões de transição continuam visíveis e quem recusa é o servidor (`403 INSUFFICIENT_ROLE`). Esconder por papel é a próxima entrega.
- **As credenciais de demonstração estão no bundle**, porque a tela as exibe — é o que o edital pede.

## Registro da entrega

**Ordem dos fatos.** A tela foi construída contra o contrato congelado, com a API simulada respondendo ao login — o backend de autenticação ainda não estava no ar quando o frontend ficou pronto.

**O que apareceu no caminho.** A verificação no navegador — e não só na suíte — encontrou um defeito **anterior** a esta entrega: o bundle de produção não montava a aplicação (issue #110). O `manualChunks` na forma de objeto deixava o núcleo do React num chunk e o `react-dom` em outro, e os dois passavam a se importar; o primeiro `forwardRef` derrubava a árvore de módulos. A CI não pegava porque roda `build`, que compila sem erro — o defeito é de execução. Corrigido no PR #112: o `#root` passou a montar 20.245 bytes de DOM (antes: 1.931, só o esqueleto).

**Outra armadilha, registrada para não se repetir.** Teste que passa pela camada HTTP real não roda no jsdom: o `fetch` do Node recusa o `AbortSignal` do realm do jsdom, e a chamada vaza para a rede voltando como `NETWORK_ERROR` — o teste "passa" pela razão errada. A suíte ficou dividida: contrato HTTP no ambiente `node`, componente com a camada de API mockada.

**Verificação.** 85 testes, tipos, lint e formato limpos; e, além da suíte, o bundle de produção servido por `vite preview` e aberto em navegador headless — temas claro e escuro, comparado com o frame do Figma.

**Entregas.** Issue [#108](https://github.com/Alysson-Araujo/logos/issues/108), PR [#113](https://github.com/Alysson-Araujo/logos/pull/113); defeito de build em [#110](https://github.com/Alysson-Araujo/logos/issues/110) / PR [#112](https://github.com/Alysson-Araujo/logos/pull/112).
