"""Retentativa vista pela camada HTTP, com falha de banco simulada.

A falha é injetada no repositório, e não no banco: assim o teste verifica a
decisão ("repetir ou não repetir?") e não o comportamento do driver.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError, OperationalError

from app.core.config import reset_settings_cache
from app.repositories.incident_repository import IncidentRepository

INCIDENTS_URL = "/api/v1/incidents"

PAYLOAD: dict[str, Any] = {
    "title": "Falha simulada de banco no meio do caminho",
    "category": "PROBLEMA_MECANICO",
    "criticality": "MEDIA",
    "reportedBy": "Verificação",
}


@pytest.fixture()
def retry_instantaneo(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Zera a espera entre tentativas, que em produção é 1 s, 2 s e 4 s."""
    monkeypatch.setenv("RETRY_BASE_DELAY_SECONDS", "0")
    reset_settings_cache()
    yield
    reset_settings_cache()


def falha_transitoria() -> OperationalError:
    """Conexão perdida: o caso que motiva a retentativa."""
    return OperationalError("SELECT 1", {}, Exception("conexao caiu"))


# --------------------------------------------------------------------------- #
# Leitura
# --------------------------------------------------------------------------- #
def test_leitura_repete_e_responde_200(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, retry_instantaneo: None
) -> None:
    original = IncidentRepository.list_incidents
    chamadas: list[int] = []

    def falha_uma_vez(self: IncidentRepository, filters: Any) -> Any:
        chamadas.append(1)
        if len(chamadas) == 1:
            raise falha_transitoria()
        return original(self, filters)

    monkeypatch.setattr(IncidentRepository, "list_incidents", falha_uma_vez)

    resposta = client.get(INCIDENTS_URL)

    assert resposta.status_code == 200
    assert len(chamadas) == 2


def test_leitura_que_falha_sempre_devolve_503_com_retry_after(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, retry_instantaneo: None
) -> None:
    chamadas: list[int] = []

    def sempre_falha(self: IncidentRepository, filters: Any) -> Any:
        chamadas.append(1)
        raise falha_transitoria()

    monkeypatch.setattr(IncidentRepository, "list_incidents", sempre_falha)

    resposta = client.get(INCIDENTS_URL)

    assert resposta.status_code == 503
    assert int(resposta.headers["Retry-After"]) >= 1
    corpo = resposta.json()["error"]
    assert corpo["code"] == "SERVICE_UNAVAILABLE"
    assert corpo["details"]["retryAfterSeconds"] >= 1
    assert corpo["requestId"]
    # Esgotou as tentativas da configuração padrão (3).
    assert len(chamadas) == 3


def test_erro_de_banco_deterministico_vira_500(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, retry_instantaneo: None
) -> None:
    """Violação de constraint é defeito nosso, não instabilidade: não é 503."""
    chamadas: list[int] = []

    def violacao(self: IncidentRepository, filters: Any) -> Any:
        chamadas.append(1)
        raise IntegrityError("INSERT", {}, Exception("duplicado"))

    monkeypatch.setattr(IncidentRepository, "list_incidents", violacao)

    resposta = client.get(INCIDENTS_URL)

    assert resposta.status_code == 500
    assert resposta.json()["error"]["code"] == "INTERNAL_ERROR"
    # Nem chegou a repetir: repetir devolveria o mesmo erro.
    assert len(chamadas) == 1


# --------------------------------------------------------------------------- #
# Escrita
# --------------------------------------------------------------------------- #
def test_escrita_sem_chave_de_idempotencia_nao_e_repetida(
    client: TestClient,
    incident_factory: Callable[..., dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
    retry_instantaneo: None,
) -> None:
    """Sem a declaração do cliente, repetir poderia reaplicar uma decisão humana."""
    incidente = incident_factory()
    chamadas: list[int] = []

    def falha(self: IncidentRepository, **kwargs: Any) -> int:
        chamadas.append(1)
        raise falha_transitoria()

    monkeypatch.setattr(IncidentRepository, "apply_status_transition", falha)

    resposta = client.post(
        f"{INCIDENTS_URL}/{incidente['id']}/status",
        json={"status": "EM_INVESTIGACAO"},
        headers={"If-Match": f'"{incidente["version"]}"'},
    )

    assert resposta.status_code == 503
    assert resposta.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert len(chamadas) == 1


def test_escrita_com_chave_de_idempotencia_e_repetida(
    client: TestClient,
    incident_factory: Callable[..., dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
    retry_instantaneo: None,
) -> None:
    incidente = incident_factory()
    original = IncidentRepository.apply_status_transition
    chamadas: list[int] = []

    def falha_uma_vez(self: IncidentRepository, **kwargs: Any) -> int:
        chamadas.append(1)
        if len(chamadas) == 1:
            raise falha_transitoria()
        return original(self, **kwargs)

    monkeypatch.setattr(IncidentRepository, "apply_status_transition", falha_uma_vez)

    resposta = client.post(
        f"{INCIDENTS_URL}/{incidente['id']}/status",
        json={"status": "EM_INVESTIGACAO"},
        headers={
            "If-Match": f'"{incidente["version"]}"',
            "Idempotency-Key": "retentativa-com-chave-0001",
        },
    )

    assert resposta.status_code == 200
    assert resposta.json()["status"] == "EM_INVESTIGACAO"
    assert len(chamadas) == 2


def test_criacao_nao_e_repetida_mesmo_com_chave(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, retry_instantaneo: None
) -> None:
    """`INSERT` não tem guarda: repetir após um commit não visto criaria um segundo incidente.

    Aqui a API devolve 503 e quem reenvia é o cliente, com a mesma chave — que é
    justamente o papel da idempotência no nível HTTP.
    """
    chamadas: list[int] = []

    def falha(self: IncidentRepository, incident: Any) -> Any:
        chamadas.append(1)
        raise falha_transitoria()

    monkeypatch.setattr(IncidentRepository, "create", falha)

    resposta = client.post(
        INCIDENTS_URL,
        json=PAYLOAD,
        headers={"Idempotency-Key": "criacao-com-chave-0001"},
    )

    assert resposta.status_code == 503
    assert len(chamadas) == 1


def test_rollback_entre_tentativas_libera_a_sessao(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, retry_instantaneo: None
) -> None:
    """A tentativa seguinte não pode herdar a transação abortada da anterior."""
    original = IncidentRepository.list_incidents
    estado: list[str] = []

    def falha_uma_vez(self: IncidentRepository, filters: Any) -> Any:
        if not estado:
            estado.append("falhou")
            raise falha_transitoria()
        estado.append("sucesso")
        return original(self, filters)

    monkeypatch.setattr(IncidentRepository, "list_incidents", falha_uma_vez)

    resposta = client.get(INCIDENTS_URL)

    assert resposta.status_code == 200
    assert estado == ["falhou", "sucesso"]
    # E a sessão continua utilizável para as requisições seguintes.
    assert client.get(INCIDENTS_URL).status_code == 200
