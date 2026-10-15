"""Classificação de falha, backoff com jitter e política por tipo de operação.

Testado sem HTTP e sem banco: a classificação e a matemática do backoff são
puras, e o `run_with_retry` recebe a função de espera, então nenhum teste dorme
de verdade.
"""

from __future__ import annotations

import random
from typing import Any

import pytest
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError

from app.infra.retry import NO_RETRY, RetryConfig, RetryPolicy, is_transient, run_with_retry


class DriverError(Exception):
    """Imita o erro do driver, que carrega o SQLSTATE."""

    def __init__(self, sqlstate: str) -> None:
        super().__init__("erro de driver simulado")
        self.sqlstate = sqlstate


def erro_operacional(mensagem: str = "conexao caiu") -> OperationalError:
    """Erro transitório típico: conexão perdida."""
    return OperationalError("SELECT 1", {}, Exception(mensagem))


# --------------------------------------------------------------------------- #
# Classificação: o que vale repetir
# --------------------------------------------------------------------------- #
def test_conexao_perdida_e_transitoria() -> None:
    assert is_transient(erro_operacional())


def test_timeout_e_transitorio() -> None:
    assert is_transient(TimeoutError("demorou demais"))


def test_serializacao_e_deadlock_sao_transitorios() -> None:
    """Os dois casos clássicos de concorrência: a transação perdeu a corrida."""
    assert is_transient(DBAPIError("UPDATE", {}, DriverError("40001")))
    assert is_transient(DBAPIError("UPDATE", {}, DriverError("40P01")))


def test_statement_timeout_do_postgres_e_transitorio() -> None:
    assert is_transient(DBAPIError("SELECT", {}, DriverError("57014")))


def test_violacao_de_unicidade_nao_e_transitoria() -> None:
    """Repetir devolveria o mesmo erro; repetir seria só custo."""
    assert not is_transient(DBAPIError("INSERT", {}, DriverError("23505")))


def test_erro_de_integridade_do_sqlalchemy_nao_e_transitorio() -> None:
    assert not is_transient(IntegrityError("INSERT", {}, Exception("duplicado")))


def test_erro_comum_nao_e_transitorio() -> None:
    assert not is_transient(ValueError("nao e erro de banco"))


def test_conexao_invalidada_pela_sqlalchemy_e_transitoria() -> None:
    """`connection_invalidated` é o próprio sinal da SQLAlchemy de que vale repetir."""
    erro = DBAPIError("SELECT 1", {}, DriverError("00000"), connection_invalidated=True)
    assert is_transient(erro)


# --------------------------------------------------------------------------- #
# Backoff e jitter
# --------------------------------------------------------------------------- #
def test_espera_cresce_exponencialmente_e_respeita_o_teto() -> None:
    politica = RetryPolicy(base_delay=1.0, factor=2.0, max_delay=8.0)
    assert [politica.ceiling_for(n) for n in (1, 2, 3, 4)] == [1.0, 2.0, 4.0, 8.0]
    # A partir do teto não cresce mais, para `max_attempts` maior não virar espera eterna.
    assert politica.ceiling_for(9) == 8.0


def test_jitter_sorteia_dentro_do_teto_e_nao_e_constante() -> None:
    """Sortear é o ponto: sem ele, todos os clientes voltam no mesmo instante."""
    politica = RetryPolicy(base_delay=1.0, factor=2.0)
    rng = random.Random(20261015)

    amostras = [politica.delay_for(1, rng=rng) for _ in range(50)]

    assert all(0.0 <= valor <= 1.0 for valor in amostras)
    assert len(set(amostras)) > 1


# --------------------------------------------------------------------------- #
# Execução com retentativa
# --------------------------------------------------------------------------- #
def test_repete_ate_conseguir() -> None:
    tentativas: list[int] = []
    esperas: list[float] = []

    def operacao() -> str:
        tentativas.append(1)
        if len(tentativas) < 3:
            raise erro_operacional()
        return "ok"

    resultado = run_with_retry(operacao, policy=RetryPolicy(max_attempts=3), sleep=esperas.append)

    assert resultado == "ok"
    assert len(tentativas) == 3
    assert len(esperas) == 2


def test_desiste_apos_o_teto_de_tentativas() -> None:
    tentativas: list[int] = []

    def operacao() -> None:
        tentativas.append(1)
        raise erro_operacional()

    with pytest.raises(OperationalError):
        run_with_retry(operacao, policy=RetryPolicy(max_attempts=3), sleep=lambda _: None)

    assert len(tentativas) == 3


def test_erro_deterministico_nao_e_insistido() -> None:
    tentativas: list[int] = []

    def operacao() -> None:
        tentativas.append(1)
        raise IntegrityError("INSERT", {}, Exception("duplicado"))

    with pytest.raises(IntegrityError):
        run_with_retry(operacao, policy=RetryPolicy(max_attempts=3), sleep=lambda _: None)

    assert len(tentativas) == 1


def test_rollback_acontece_antes_de_cada_espera() -> None:
    """A ordem importa: repetir sem descartar a transação abortada falharia de novo."""
    ordem: list[str] = []
    tentativas: list[int] = []

    def operacao() -> str:
        tentativas.append(1)
        if len(tentativas) < 2:
            raise erro_operacional()
        return "ok"

    run_with_retry(
        operacao,
        policy=RetryPolicy(max_attempts=3),
        on_retry=lambda _erro: ordem.append("rollback"),
        sleep=lambda _espera: ordem.append("espera"),
    )

    assert ordem == ["rollback", "espera"]


def test_politica_desligada_nao_espera_nem_repete() -> None:
    tentativas: list[int] = []

    def operacao() -> None:
        tentativas.append(1)
        raise erro_operacional()

    with pytest.raises(OperationalError):
        run_with_retry(operacao, policy=NO_RETRY)

    assert len(tentativas) == 1


# --------------------------------------------------------------------------- #
# Política por tipo de operação
# --------------------------------------------------------------------------- #
def politica_ligada() -> RetryPolicy:
    return RetryPolicy(max_attempts=3)


def test_leitura_e_sempre_repetivel() -> None:
    com_chave = RetryConfig(policy=politica_ligada(), request_allows_replay=True)
    sem_chave = RetryConfig(policy=politica_ligada(), request_allows_replay=False)

    assert com_chave.for_read().max_attempts == 3
    assert sem_chave.for_read().max_attempts == 3


def test_escrita_condicional_depende_da_chave_de_idempotencia() -> None:
    """A chave é a declaração do cliente de que a operação é reenviável."""
    com_chave = RetryConfig(policy=politica_ligada(), request_allows_replay=True)
    sem_chave = RetryConfig(policy=politica_ligada(), request_allows_replay=False)

    assert com_chave.for_conditional_write().max_attempts == 3
    assert sem_chave.for_conditional_write().max_attempts == 1


def test_criacao_nunca_e_repetida() -> None:
    """`INSERT` não tem guarda: repetir após um commit não visto duplicaria o registro."""
    com_chave = RetryConfig(policy=politica_ligada(), request_allows_replay=True)
    assert com_chave.for_insert().max_attempts == 1


def test_config_padrao_desliga_tudo() -> None:
    padrao = RetryConfig()
    assert padrao.for_read().max_attempts == 1
    assert padrao.for_conditional_write().max_attempts == 1


def test_retry_after_nunca_e_zero() -> None:
    """Um `Retry-After: 0` faria o cliente repetir imediatamente, que é o oposto do objetivo."""
    instantaneo = RetryConfig(policy=RetryPolicy(max_attempts=3, base_delay=0.0))
    assert instantaneo.policy.retry_after_seconds >= 1


def test_anotacao_de_tipo_sobrevive_a_retentativa() -> None:
    """O genérico do `run_with_retry` preserva o tipo do retorno."""

    def operacao() -> dict[str, Any]:
        return {"ok": True}

    resultado: dict[str, Any] = run_with_retry(operacao, policy=NO_RETRY)
    assert resultado == {"ok": True}
