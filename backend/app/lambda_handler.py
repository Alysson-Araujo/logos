"""Ponto de entrada da API quando ela roda no AWS Lambda.

O Mangum converte o evento do Lambda em uma chamada ASGI. O FastAPI continua
sendo o mesmo: o que muda e o transporte, nao a aplicacao.

Por que isto existe: o Lambda nao executa um servidor escutando uma porta — ele
chama uma funcao quando alguem chega. O `uvicorn`, que e um servidor de verdade,
nao tem o que fazer la dentro. O Mangum faz esse papel: traduz o JSON do evento
para o protocolo ASGI que o FastAPI entende, e a resposta de volta.
"""

from __future__ import annotations

from mangum import Mangum

from app.main import app

# lifespan="on" garante que o startup roda no cold start — e e no startup que
# `ensure_schema_is_migrated()` confere se o Alembic foi aplicado. Sem isso, a
# primeira requisicao de um container novo falharia com erro de tabela
# inexistente, em vez de falhar cedo e com instrucao acionavel.
handler = Mangum(app, lifespan="on")
