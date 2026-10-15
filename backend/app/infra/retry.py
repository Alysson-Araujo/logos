"""Repetição de operações de banco que falharam por motivo transitório.

**O problema.** Parte das falhas de banco não é defeito e não se repete: a
conexão do pool morreu por ociosidade, o banco reiniciou para aplicar um patch,
duas transações se encontraram e uma foi abortada por *deadlock*, o
`statement_timeout` cancelou uma consulta que voltaria na segunda tentativa.
Devolver erro ao analista nesses casos é jogar fora uma operação que daria
certo — e num sistema de missão crítica isso é uma tela de erro a mais para
quem já está sob pressão.

**O que NÃO é repetido.** Violação de constraint, dado inválido e erro de
programação são determinísticos: repetir devolve o mesmo erro, com o custo
somado. Só entram na lista as falhas de infraestrutura, e a classificação é
explícita (SQLSTATE, não mensagem de texto).

**Por que jitter.** Quando o banco volta depois de uma indisponibilidade, todos
os clientes que estavam bloqueados tentam reconectar no mesmo instante e a
recarga derruba o banco de novo — o efeito manada. Sortear a espera dentro do
teto espalha as tentativas. O sorteio é **completo** (`uniforme(0, teto)`), que é
a forma mais eficaz de espalhar; o teto é que cresce exponencialmente.

**Limite honesto.** Repetir uma mutação só é seguro quando a operação é
idempotente. Leitura é sempre. Escrita só é quando a requisição trouxe uma
`Idempotency-Key`, porque aí o servidor reconhece o reenvio. Escrever sem chave
não é repetido de forma alguma: nesse caso a API devolve `503` com `Retry-After`
e deixa a decisão com o cliente. Reprocessar uma decisão humana que talvez já
tenha sido gravada seria pior do que admitir a falha.
"""

from __future__ import annotations

import random
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final

from sqlalchemy.exc import DBAPIError, DisconnectionError, OperationalError

#: SQLSTATEs que valem uma nova tentativa. Códigos, e não trechos de mensagem:
#: a mensagem muda entre versões do driver e com o idioma do servidor.
TRANSIENT_SQLSTATES: Final[frozenset[str]] = frozenset(
    {
        "40001",  # serialization_failure
        "40P01",  # deadlock_detected
        "55P03",  # lock_not_available
        "57014",  # query_canceled (statement_timeout)
        "08000",  # connection_exception
        "08001",  # sqlclient_unable_to_establish_sqlconnection
        "08003",  # connection_does_not_exist
        "08004",  # sqlserver_rejected_establishment_of_sqlconnection
        "08006",  # connection_failure
    }
)


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    """Quantas vezes repetir e quanto esperar entre as tentativas."""

    max_attempts: int = 3
    base_delay: float = 1.0
    factor: float = 2.0
    max_delay: float = 8.0

    def ceiling_for(self, attempt: int) -> float:
        """Teto de espera após a tentativa informada: 1 s, 2 s, 4 s, 8 s…

        O teto existe para o jitter ter onde sortear, e o `max_delay` impede que
        a espera cresça sem limite se alguém aumentar `max_attempts`.
        """
        return min(self.max_delay, self.base_delay * (self.factor ** (attempt - 1)))

    def delay_for(self, attempt: int, *, rng: random.Random | None = None) -> float:
        """Espera da tentativa, com jitter completo dentro do teto."""
        gerador = random if rng is None else rng
        return gerador.uniform(0, self.ceiling_for(attempt))

    @property
    def retry_after_seconds(self) -> int:
        """`Retry-After` sugerido quando a política se esgota."""
        return max(1, int(self.base_delay) or 1)


#: Sem repetição: usada em mutação sem `Idempotency-Key`.
NO_RETRY: Final[RetryPolicy] = RetryPolicy(max_attempts=1)


@dataclass(frozen=True, slots=True)
class RetryConfig:
    """Decisão de retentativa para a requisição atual.

    Repetir nem sempre é seguro, e "seguro" depende da **operação**, não do
    método HTTP. São três casos, com motivos diferentes:

    - **leitura** é sempre repetível: não muda estado;
    - **escrita condicional** (o `UPDATE ... WHERE version = ?` do lock
      otimista) é repetível porque uma segunda execução não encontra a versão
      esperada e não produz efeito novo — mas só é repetida quando o cliente
      mandou `Idempotency-Key`, declarando a operação como reenviável;
    - **INSERT** não tem guarda nenhuma: repetir criaria um segundo registro.
      Não é repetido de forma alguma; nesse caso a API devolve `503` e deixa a
      decisão com o cliente, que reenvia com a mesma chave.
    """

    policy: RetryPolicy = NO_RETRY
    #: O cliente declarou a operação como reenviável (enviou `Idempotency-Key`).
    request_allows_replay: bool = False

    def for_read(self) -> RetryPolicy:
        """Leitura não muda estado: repetir é sempre seguro."""
        return self.policy

    def for_conditional_write(self) -> RetryPolicy:
        """Escrita guardada por compare-and-swap, com a declaração do cliente."""
        return self.policy if self.request_allows_replay else NO_RETRY

    def for_insert(self) -> RetryPolicy:
        """Criação: sem guarda natural, repetir poderia duplicar o registro."""
        return NO_RETRY


def _sqlstate_of(error: DBAPIError) -> str | None:
    """Extrai o SQLSTATE do erro original do driver, quando existir."""
    sqlstate = getattr(error.orig, "sqlstate", None)
    return sqlstate if isinstance(sqlstate, str) else None


def is_transient(error: BaseException) -> bool:
    """Diz se vale a pena repetir a operação que falhou.

    A ordem importa: `OperationalError` é subclasse de `DBAPIError`, e é
    justamente a que cobre queda de conexão e "database is locked".
    """
    if isinstance(error, (DisconnectionError, OperationalError, TimeoutError)):
        return True
    if isinstance(error, DBAPIError):
        # A própria SQLAlchemy marca quando precisou invalidar a conexão.
        if error.connection_invalidated:
            return True
        return _sqlstate_of(error) in TRANSIENT_SQLSTATES
    return False


def run_with_retry[T](
    operation: Callable[[], T],
    *,
    policy: RetryPolicy,
    on_retry: Callable[[BaseException], None] | None = None,
    sleep: Callable[[float], None] | None = None,
) -> T:
    """Executa a operação, repetindo enquanto a falha for transitória.

    `on_retry` roda antes de cada espera — é onde a sessão recebe `rollback()`,
    para a próxima tentativa começar de um estado limpo em vez de herdar a
    transação abortada.
    """
    dormir = sleep if sleep is not None else time.sleep
    for attempt in range(1, policy.max_attempts + 1):
        try:
            return operation()
        except Exception as exc:
            if attempt >= policy.max_attempts or not is_transient(exc):
                raise
            if on_retry is not None:
                on_retry(exc)
            dormir(policy.delay_for(attempt))

    # Inalcançável com max_attempts >= 1; existe para o verificador de tipos.
    raise RuntimeError("laco de retentativa terminou sem retorno nem excecao")
