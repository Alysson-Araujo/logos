# ADR 0016 — Sessão em `sessionStorage`

- **Status:** Aceito
- **Data:** 2026-10-17
- **Contexto relacionado:** Autenticação no frontend (issue #108) e API de autenticação (issues #100, #109, #111)

## Contexto

Com a autenticação no lugar, o frontend precisa guardar o token de acesso e enviá-lo em cada requisição. As duas pontas ficam em **origens diferentes** — frontend na Vercel, API no Render —, e é isso que decide o assunto: um cookie entre sites depende de `SameSite=None`, que o Safari bloqueia por padrão, e de CORS com credenciais, com origem explícita no lugar de `*`.

O risco do outro lado é conhecido: token acessível por JavaScript é token exposto a XSS.

## Decisão

**`sessionStorage`**, com o token no cabeçalho `Authorization: Bearer` e validade definida pela API (8 horas).

- A sessão **morre com a aba**: recarregar mantém, fechar encerra.
- `expiresAt` é calculado no login a partir de `expiresIn`, para a interface saber se a sessão ainda vale sem perguntar ao servidor.
- O 401 de uma chamada autenticada limpa a sessão e devolve ao login; o 401 do próprio login é exceção declarada (`skipAuth`).

## Alternativas consideradas

- **`localStorage`.** Descartado: sobrevive ao fechamento da aba sem que ninguém tenha pedido. O frame de login não tem "lembrar-me", e manter token vivo em máquina compartilhada é o oposto do que a tela promete.
- **Cookie `httpOnly`.** É o desenho de produção, e foi descartado **por ora** por um motivo de demonstração: com as duas pontas em domínios diferentes, o cookie exige `SameSite=None` e o Safari bloqueia cookies de terceiros. Um login que não funciona na frente de quem avalia custa mais do que o risco que ele elimina. O caminho de produção — proxy de mesma origem na Vercel, ou refresh em cookie `httpOnly` com rotação — está registrado como próximo passo.
- **Token só em memória.** Descartado: recarregar a página deslogaria. O ganho de segurança seria parcial, porque o token já trafega por JavaScript na resposta do login.
- **Ofuscar ou cifrar o token no cliente.** Descartado: não acrescenta segurança. Quem executa script na página tem a chave no mesmo lugar.

## Consequências

### Positivas

- Nenhuma configuração de CORS com credenciais e nenhuma negociação de `SameSite`: o cabeçalho se comporta igual em qualquer navegador.
- Fechar a aba encerra a sessão sem código adicional nem prazo a limpar.
- O tratamento de 401 vive num lugar só (`lib/http.ts`) e não conhece o store: quem liga os dois é `wireAuthSession()`, no bootstrap.

### Negativas / trade-offs

- **XSS entrega o token.** Mitigado pelo que já existe: nenhum `dangerouslySetInnerHTML` no código, React escapando todo texto de incidente, e TTL curto. Assumido de forma explícita — está no README e é o que se explica na entrevista.
- **Sem refresh.** Vencidas as 8 horas, a pessoa entra de novo. Aceitável numa demonstração; inaceitável numa central em operação, e por isso está no roadmap.
- **A credencial de demonstração está no bundle.** Consequência direta de exibi-la na tela inicial, como o edital pede. Vale para a demonstração, não para produção.
