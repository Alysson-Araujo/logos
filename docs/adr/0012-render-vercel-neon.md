# ADR 0012 — Render, Vercel e Neon como plataforma de produção

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E8 — Deploy & Observabilidade (issues #63 e #64)

## Contexto

A entrega exige aplicação acessível publicamente e sem instalação. Os requisitos concretos: Postgres gerenciado, porque o lock otimista e a paginação por cursor precisam do comportamento real de produção ([ADR 0003](0003-postgres-e-sqlite.md)); deploy contínuo a partir do GitHub, sem etapa manual; front estático em CDN com HTTPS; capacidade de manter uma **conexão SSE aberta** ([ADR 0011](0011-sse.md)), o que descarta runtimes que bufferizam a resposta; e custo zero, porque é um case. Há ainda uma restrição do ambiente: **Docker não está instalado**, então plataformas que exigem build local de imagem saem da lista de caminhos diretos.

## Decisão

| Camada | Plataforma | Configuração |
| --- | --- | --- |
| Frontend | **Vercel** | Root `frontend/`, framework Vite, build `pnpm build`, saída `dist` |
| API | **Render** | Root `backend/`, `pip install -e .`, `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Banco | **Neon** | PostgreSQL serverless, `DATABASE_URL` com `?sslmode=require` |

A combinação de três serviços gratuitos com deploy direto do repositório mantém o `git push` como única ação de publicação.

## Alternativas consideradas

- **Hugging Face Spaces.** Descartado: é feito para demonstrar modelos, não para servir API REST com Postgres gerenciado. A instância hiberna e a conexão persistente do SSE não sobrevive ao ciclo de suspensão.
- **Replit.** Descartado: recursos expiram e o ambiente reinicia por política — uma aplicação que precisa estar de pé no dia da avaliação não pode depender disso.
- **Fly.io.** Tecnicamente a melhor opção da lista, descartada por restrição de ambiente: o fluxo padrão exige Docker. Permanece como reserva.
- **Railway.** Boa experiência de desenvolvimento, com free tier que deixou de ser generoso. Reserva.
- **AWS (S3 + CloudFront + App Runner + RDS).** Atende tudo, e o custo é em tempo de configuração: VPC, subnets privadas, *security groups*, IAM, Secrets Manager e RDS Proxy. O caminho está descrito em `docs/08-deploy.md`, mas não é o que o prazo comporta.
- **Apenas local, com justificativa.** Contraria o requisito de deploy público e o checklist de entrega.

## Consequências

### Positivas

- Publicação por `git push`, sem etapa manual e sem credencial de nuvem no repositório.
- Postgres gerenciado com SSL obrigatório e *branching* por ambiente, sem administrar servidor.
- Front estático em CDN com HTTPS automático e *preview* por pull request.
- `GET /health/ready` funciona como *health check* real da plataforma; o log estruturado em JSON já sai em `stdout`, sem agente de coleta.

### Negativas / trade-offs

- **Cold start de aproximadamente 30 segundos** no plano gratuito: o serviço hiberna e sobe no primeiro acesso. A mitigação é aquecer com `GET /health/live`, manter o timeout do cliente compatível e **declarar o comportamento** em vez de escondê-lo.
- **O banco serverless suspende por inatividade**, tornando a primeira requisição mais lenta; o retry com jitter e o cache *stale* absorvem.
- **Nenhuma configuração de rede própria** — sem VPC, IP fixo ou controle de *firewall*. Adequado ao escopo, e é o que limitaria a opção em um cenário corporativo.
- **Concentração em três planos gratuitos**, cujos termos podem mudar. O projeto não depende de API proprietária de nenhum: migrar é reconfigurar `DATABASE_URL`, o start command e a variável do front.
