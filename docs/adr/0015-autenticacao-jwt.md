# ADR 0015 — Autenticação com JWT e autorização por papel

- **Status:** Aceito
- **Data:** 2026-10-17
- **Contexto relacionado:** E2 — Ciclo de vida & Concorrência (auditoria) e E3 — Resiliência

## Contexto

A auditoria do ciclo de vida (`GET /incidents/{id}/events`) registra **quem** fez cada mudança. Até esta decisão, esse "quem" era um campo de texto enviado no corpo da requisição:

| Evento           | Campo de origem   | Problema                                                   |
| ---------------- | ----------------- | ---------------------------------------------------------- |
| `CREATED`        | `reportedBy`      | É o **canal** de origem ("Rádio Frota 12"), não uma pessoa |
| `STATUS_CHANGED` | `assignedAnalyst` | Quem o cliente **declarou** ser                            |
| `DELETED`        | —                 | Não registrava autor                                       |

Na prática, qualquer pessoa podia enviar `assignedAnalyst: "Marina Duarte"` e o histórico passava a afirmar que foi ela. **Um registro de auditoria que o cliente escreve não é auditoria** — e era esse o defeito central, não a ausência de uma tela de login.

Havia ainda duas consequências operacionais: qualquer pessoa na internet podia listar, fechar e remover incidentes; e o perfil de quem apenas reporta um chamado (rádio, 0800) não existia.

## Decisão

### 1. Token JWT assinado (HS256), enviado como `Authorization: Bearer`

| Aspecto              | Escolha                                                  |
| -------------------- | -------------------------------------------------------- |
| Algoritmo            | HS256, com a lista de algoritmos **fixa na verificação** |
| Claims               | `sub` (id), `jti` (id do token), `role`, `iat`, `exp`    |
| Validade             | 8 horas — cobre um turno sem novo login                  |
| Onde fica no cliente | `sessionStorage`                                         |
| Revogação            | Tabela `revoked_tokens`, consultada por `jti`            |

**A lista de algoritmos é fixa** (`algorithms=["HS256"]`) e as claims `exp`, `sub` e `jti` são obrigatórias. Escolher o algoritmo a partir do campo `alg` do próprio token é a vulnerabilidade clássica de JWT: o atacante assina com `none` ou troca RSA por HMAC usando a chave pública como segredo.

**A assinatura é conferida antes de qualquer acesso ao banco.** Um token forjado custa zero de I/O — é o argumento que sustenta o JWT neste caso, e não a "falta de estado".

### 2. Revogação real no logout

O `jti` entra numa lista de bloqueio e o token deixa de valer imediatamente. Sem isso, sair da aplicação seria apenas o cliente esquecendo o token, e um token capturado continuaria válido até vencer.

### 3. Autorização por papel, com a matriz em um único lugar

`REPORTER` registra e acompanha o que ele mesmo abriu; `ANALYST` conduz a fila inteira; `ADMIN` é o único que remove.

A matriz vive em `domain/permissions.py`, e não em dependências espalhadas por rota. O motivo é de auditoria: existe um ponto único para responder "quem pode o quê", e a suíte verifica a matriz inteira (papel × permissão) de uma vez, em vez de descobrir buracos rota a rota.

### 4. Falhas de autenticação distinguem três situações, e só elas

| HTTP | Código                | Quando                                                                     |
| ---- | --------------------- | -------------------------------------------------------------------------- |
| 401  | `INVALID_CREDENTIALS` | Login: e-mail errado, senha errada **ou conta desativada**                 |
| 401  | `UNAUTHENTICATED`     | Sem token, token inválido, revogado, ou usuário desativado depois do login |
| 401  | `TOKEN_EXPIRED`       | Token vencido — **separado de propósito**                                  |
| 403  | `INSUFFICIENT_ROLE`   | Autenticado, mas o papel não permite                                       |

`TOKEN_EXPIRED` é separado porque é o único caso em que o cliente pode renovar a sessão em vez de voltar ao login. Sem essa distinção, a interface não consegue decidir entre as duas coisas.

**`INVALID_CREDENTIALS` é idêntico para e-mail inexistente, senha errada e conta desativada.** Diferenciá-los revelaria quais e-mails existem; e uma resposta própria para conta desativada confirmaria que a senha estava certa. Pelo mesmo motivo, o caminho de e-mail inexistente executa uma verificação Argon2 descartável: sem ela, o **tempo de resposta** entregaria o que a mensagem esconde.

## Alternativas consideradas

| Alternativa                             | Por que não                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Token em cookie `httpOnly`**          | Front na Vercel e API no Render são sites diferentes: exigiria `SameSite=None` + `Secure` + credenciais com origem exata. Não é uma falha intermitente — é **política de navegador**: o Safari bloqueia cookie de terceiro por padrão e o Chrome está eliminando. Trocar um ponto de falha por três, com a demo ao vivo, é mau negócio |
| **Token opaco (sessão em tabela)**      | Defenderia melhor que o JWT aqui, porque o usuário é carregado do banco em toda requisição de qualquer forma. Perde no ponto específico: com JWT um token forjado é recusado **antes** de qualquer I/O                                                                                                                                 |
| **Sessão em `localStorage`**            | Sobrevive ao fechamento da aba, mas a tela de login não tem "lembrar-me": guardar o token mais tempo do que a sessão de uso seria exposição sem contrapartida                                                                                                                                                                          |
| **Sem autenticação, confiando na rede** | A auditoria continuaria sendo texto que o cliente escolhe                                                                                                                                                                                                                                                                              |

## Consequências

| Aspecto             | Efeito                                                                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auditoria           | `actor` passa a ser quem **realmente** agiu; `reportedBy` permanece como canal de origem                                                                |
| Visibilidade        | O escopo por papel entra na **query** da listagem, então o total do `meta` e os KPIs do topo ficam escopados junto                                      |
| Privacidade         | Quem não enxerga um incidente recebe **404**, não 403: "existe, mas não é seu" revelaria a existência do registro                                       |
| Responsável         | `assignedAnalyst` deixa de ser campo de texto e passa a ser consequência da ação: assumir a investigação atribui, devolver à fila limpa                 |
| Seed                | Quatro contas de demonstração, com senhas dentro da política mínima de 12 caracteres                                                                    |
| Chave de assinatura | A aplicação **recusa subir em produção** com a chave de exemplo: uma chave pública é pior que nenhuma, porque qualquer pessoa forja um token de `ADMIN` |
| Senhas              | Argon2id, com sal por senha e parâmetros de custo embutidos no hash                                                                                     |
| **Fase 2**          | Refresh token em cookie `httpOnly` com rotação, mantendo o token de acesso em memória                                                                   |

## Verificação

- `tests/unit/test_tokens.py` — hash, emissão, adulteração, expiração, algoritmo `none`, chave estranha
- `tests/unit/test_permissions.py` — a matriz completa, papel × permissão
- `tests/integration/test_auth_api.py` — login, logout, identidade e troca de senha
- `tests/integration/test_permissions.py` — escopo de visibilidade, permissões de escrita e autoria dos eventos
