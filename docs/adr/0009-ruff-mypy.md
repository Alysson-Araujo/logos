# ADR 0009 — Ruff e mypy no backend

- **Status:** Aceito
- **Data:** 2026-02-11
- **Contexto relacionado:** E0 — Fundação (issue #5, `chore/5-ruff-mypy`) e E7

## Contexto

O backend tem contrato de domínio fechado: três enumerações de valores fixos, schemas Pydantic derivados de tipos e um cálculo de prioridade testado por faixa. A CI precisa rodar lint, formatação e verificação de tipos em cada pull request — mas verificação que só roda na CI chega tarde, e o autor conserta em um commit adicional, deixando o histórico com ruído de correção de formatação. Para que a verificação aconteça no _pre-commit_, ela precisa ser rápida.

## Decisão

**Ruff** como linter e formatador, e **mypy em modo `strict`** como verificador de tipos, ambos configurados no `pyproject.toml` — com as regras de segurança (`S`) valendo no código da aplicação e desativadas em `tests/**`, onde `assert` é ferramenta de asserção e não risco:

```toml
[tool.ruff]
line-length = 100
target-version = "py312"
[tool.ruff.lint]
select = ["E", "F", "W", "I", "N", "UP", "B", "C4", "SIM", "RUF", "S", "ANN"]
[tool.mypy]
python_version = "3.12"
strict = true
plugins = ["pydantic.mypy"]
```

## Alternativas consideradas

- **flake8 + isort + black.** Descartado: são quatro ferramentas, quatro configurações e quatro execuções para fazer o que uma faz. A lentidão relativa é a causa prática do problema — quando o lint é lento, ele migra para a CI e a verificação chega depois do push. A configuração também se espalha por `.flake8`, `setup.cfg` e `pyproject.toml`.
- **Pyright.** Descartado por margem estreita: é mais rápido e tem ótima inferência. mypy foi escolhido por ser o padrão do ecossistema para bibliotecas e por ter o _plugin_ oficial do Pydantic, que resolve a tipagem de modelos derivados — justamente onde o contrato vive.
- **Sem verificador de tipos.** Descartado: com `str, Enum`, generics de repositório e schemas derivados, a ausência de verificação deixa o contrato do domínio sem garantia, e a anotação passa a ser comentário.
- **Black isolado, sem lint.** Descartado: formatação uniforme não detecta `assert` em produção, import circular, sombreamento de nome nem complexidade — os defeitos que a revisão procura.

## Consequências

### Positivas

- Uma única seção em `pyproject.toml` governa lint e formatação, em execução de milissegundos.
- mypy `strict` transforma uma transição escrita com `str` cru em erro de verificação, em vez de erro em produção.
- `ruff format --check .` na CI garante que o estilo não depende de o desenvolvedor lembrar de formatar.
- `--strict-markers` no pytest fecha a mesma brecha do lado dos testes: marcador não declarado é erro, não aviso.

### Negativas / trade-offs

- **Ruff é mais novo** e tem verificações mais agressivas que o equivalente em flake8, exigindo configuração pontual. A compensação é a configuração unificada e a velocidade.
- **mypy `strict` cobra anotações completas**, inclusive de retorno — aumenta o trabalho por arquivo, e é o trabalho que dá sentido à verificação.
- Alguns `# type: ignore` pontuais em bibliotecas de tipagem incompleta; `warn_unused_ignores` impede que se acumulem.
- mypy é mais lento que Pyright; para o tamanho deste backend, a diferença não é perceptível no ciclo de desenvolvimento, e o hook `pre-push` cobre commits rápidos.
