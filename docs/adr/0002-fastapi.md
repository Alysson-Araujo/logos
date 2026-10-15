# ADR 0002 — FastAPI como framework da API

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E1 — Backend Core (issue #9, `feat/9-fastapi-bootstrap`)

## Contexto

O briefing pede uma API em Python robusta, e o case avalia explicitamente organização de camadas, validação e tratamento de erro. Além do CRUD, a API precisa validar entrada com rigor (nunca devolver `500` por payload inesperado), expor contrato navegável para quem avalia, manter conexão SSE aberta por cliente da central e caber em um ambiente de deploy gratuito.

## Decisão

**FastAPI** sobre **Python 3.12**, com **Pydantic v2** para validação e **uvicorn** como servidor ASGI. As rotas ficam em `api/v1/` por domínio, com injeção de dependência em `api/deps.py` para sessão e serviço. Um *exception handler* global normaliza toda resposta de erro no envelope `{"error": {code, message, details, requestId, timestamp}}`, inclusive os erros que o framework geraria no formato padrão `{"detail": [...]}`.

## Alternativas consideradas

- **Flask.** Descartado: sendo minimalista, exigiria escrever à mão a validação (que viraria `if` na rota), a serialização e a documentação OpenAPI — três superfícies adicionais de erro em um case que avalia justamente robustez e validação.
- **Django REST Framework.** Descartado: traz ORM, admin, migrações e `settings` acoplados. Usar só a camada de API significaria carregar o framework inteiro e conviver com duas modelagens de dados conflitantes, já que o projeto precisa de `UPDATE` condicional explícito.
- **Litestar.** Tecnicamente competitivo, com ecossistema e base de exemplos menores. Em prazo curto e sem equipe para absorver custo de aprendizado, maturidade de ecossistema é critério de decisão.
- **ASGI puro, sem framework.** Descartado: reimplementaria roteamento, serialização, validação e documentação sem nenhum ganho em troca.

## Consequências

### Positivas

- OpenAPI 3.1 gerado dos mesmos tipos que validam a entrada, servido em `/docs` e `/redoc`: não existe documento paralelo que possa desatualizar.
- `Depends` mantém sessão e serviço fora da assinatura da rota, preservando a camada de API livre de regra de negócio.
- `async def` permite manter conexões SSE abertas sem ocupar uma *thread* do pool do servidor por cliente conectado.
- O handler global foi o ponto único que permitiu padronizar todo o catálogo de erros do projeto.

### Negativas / trade-offs

- Não traz autenticação, admin, ORM nem migrações: o banco é decisão separada ([ADR 0003](0003-postgres-e-sqlite.md)) e a autenticação real ficou declarada fora de escopo.
- O ciclo de *release* do Pydantic v2 impacta o framework, dado o acoplamento entre versões; as dependências têm faixa fixada.
- Conviver com dois níveis de validação (formato no Pydantic, semântica no domínio) exige disciplina para não duplicar a mesma verificação em ambos.
