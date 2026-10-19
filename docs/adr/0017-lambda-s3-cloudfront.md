# ADR 0017 — Lambda, S3 e CloudFront no lugar de Render e Vercel

- **Status:** Aceito
- **Data:** 2026-10-18
- **Substitui:** [ADR 0012](0012-render-vercel-neon.md) (Render, Vercel e Neon)
- **Contexto relacionado:** E8 — Deploy & Observabilidade; [ADR 0011](0011-sse.md) (SSE)

## Contexto

A primeira entrega publicou o produto em Render (API) + Vercel (front) + Neon
(banco), conforme o [ADR 0012](0012-render-vercel-neon.md). Essa arquitetura
funcionou e custou zero — mas tinha três problemas, e um deles apareceu no
primeiro dia.

**O front nunca subiu.** O build da Vercel falhava com
`the installed pnpm wrapper is missing`, um atrito entre o `pnpm@12.4.1` (reescrita
em Rust, empacotada como _wrapper_) e o resolvedor de engine da plataforma. A
correção é conhecida — `ENABLE_EXPERIMENTAL_COREPACK=1` —, mas o episódio expôs o
custo de depender de um ambiente de build que não se controla.

**O cold start de ~30 s é do provedor, não da aplicação.** Ele é aceitável numa
demonstração e ruim numa central de operação: a analista abre a tela no momento
em que precisa dela.

**A entrega pede AWS.** O case é de uma vaga cujo dia a dia é AWS, e a decisão
anterior registrava a AWS como *"alternativa descrita, não adotada"* por custo de
tempo. Com a Onda 1 já publicada e funcionando, o tempo deixou de ser o gargalo.

A restrição que governou tudo: **gastar o mínimo**. Não "usar AWS", mas usar AWS
sem transformar uma demonstração numa conta mensal.

## Decisão

| Camada   | Serviço                                            | Configuração                                          |
| -------- | -------------------------------------------------- | ----------------------------------------------------- |
| Frontend | **S3 + CloudFront**                                | Bucket privado, acesso só via OAC. `PriceClass_100`.  |
| API      | **Lambda (imagem) + Function URL**                 | FastAPI com Mangum. 1.024 MB, 30 s, **fora de VPC**.  |
| Imagem   | **ECR**                                            | Base `public.ecr.aws/lambda/python:3.12`.             |
| Banco    | **Neon** (mantido do ADR 0012)                     | Fora da AWS. Endpoint direto, TLS obrigatório.        |
| Deploy   | **GitHub Actions com OIDC**                        | Sem segredo de longa duração no repositório.          |

**A decisão central não é a Lambda: é manter o banco fora da AWS.** É ela que
remove VPC, NAT Gateway, RDS e Secrets Manager de uma vez — e é o que separa
US$ 0,023/mês de US$ 33/mês.

## Alternativas consideradas

- **App Runner + RDS.** O desenho do ADR 0012. Descartado pelo custo de
  configuração e pelo preço: RDS `db.t4g.micro` mais o NAT Gateway necessário
  para a API alcançá-lo somam mais de US$ 45/mês. É a arquitetura "correta" para
  uma empresa, e a errada para uma demonstração.
- **EC2.** Descartado: não escala a zero. Uma instância ligada 24/7 custa mais por
  mês do que todo o resto desta arquitetura custa por ano, e ainda exige
  administrar sistema operacional, patch e proxy reverso.
- **ECS Fargate.** Descartado: o custo mínimo de um serviço sempre ligado é uma
  ordem de grandeza acima, e o ganho sobre a Lambda seria só não ter cold start.
- **API Gateway na frente da Lambda.** Descartado: a Function URL entrega o mesmo
  resultado sem o componente extra. O API Gateway REST custa por milhão de
  requisições **e** por GB trafegado; a Function URL não cobra nada além da Lambda.
- **Lambda em VPC, com o Neon.** Descartado: função em VPC perde rota para a
  internet e exige NAT Gateway (US$ 32,85/mês) para alcançar o banco externo. O
  custo seria maior que o de hospedar o banco dentro da AWS.
- **Voltar tudo para a Render e manter a AWS só no papel.** Descartado: a
  arquitetura que ninguém usa é a que quebra sem ninguém ver.

## Consequências

### Positivas

- **Custo medido de US$ 0,023/mês.** O único item cobrado é o armazenamento da
  imagem no ECR (0,228 GB × US$ 0,10/GB-mês). Lambda, CloudFront e S3 cabem nas
  faixas *Always Free*.
- **Escala a zero de verdade.** Fora do horário de uso, o custo é o do ECR.
- **Nenhum segredo de longa duração no repositório.** O GitHub assume uma role por
  OIDC; a confiança é restrita a `repo:…:ref:refs/heads/main`.
- **Deploy sem intervenção.** Cada merge na `main` publica os dois lados, e a
  falha abre issue sozinha.
- **CloudFront dá HTTPS sem certificado para gerenciar**, com invalidação no
  deploy — as primeiras mil invalidações por mês são gratuitas.

### Negativas / trade-offs

- **A conexão SSE não sobrevive.** Este é o custo real da mudança. A Function URL
  é `BUFFERED` e não mantém a resposta aberta; `GET /incidents/stream`
  ([ADR 0011](0011-sse.md)) funciona no ambiente local e não em produção. A
  alternativa seria API Gateway com _streaming_ ou App Runner — ambos por um
  preço que o resto da decisão não justifica. **O limite está declarado, não
  escondido**, e o front já trata a ausência do stream.
- **Cold start de 1,5 a 2,5 s** na primeira invocação de cada ambiente. Menor que
  os ~30 s da Render, e ainda assim um custo que quem usa sente.
- **Uma requisição por ambiente.** Sem estado em processo, sem cache local entre
  invocações. O rate limit, que na Render seria em memória, precisou de outra
  solução.
- **`/tmp` é o único disco**, e o limite de execução é de 15 minutos.
- **A base da imagem não é escolha livre.** `python:3.12-slim` constrói e publica
  sem erro — e a função nunca inicia, porque falta o `aws-lambda-ric`. Só a base
  oficial da AWS funciona.
- **O banco continua fora da AWS.** Para este escopo é vantagem; num cenário
  corporativo, seria a primeira coisa a mudar.

## Verificação

O que sustenta esta decisão não é estimativa:

| Item                         | Valor medido                                  |
| ---------------------------- | --------------------------------------------- |
| Imagem no ECR                | 227.961.202 bytes (0,228 GB) → US$ 0,0228/mês |
| NAT Gateway                  | US$ 32,85/mês — **não existe na conta**       |
| ALB                          | ~US$ 16/mês — **não existe na conta**         |
| `VpcConfig` da função        | `null` (confirmado no recurso publicado)      |
| `/health/live` e `/health/ready` | HTTP 200 em produção                      |
| Custo total medido           | **US$ 0,023/mês**                             |

O orçamento da conta tem alerta em US$ 5, com aviso por e-mail em gasto real e
em previsão — para o caso de a estimativa estar errada.
