"""Timeline de auditoria: o que fica registrado, e o que não fica.

A auditoria só tem valor se for completa e se não registrar o que não aconteceu.
Os dois lados são testados aqui: toda mudança de estado gera evento, e toda
mudança **recusada** não gera.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient

INCIDENTS_URL = "/api/v1/incidents"

#: Nome da conta ANALYST da suíte (ver `CONTAS_DA_SUITE` no conftest). É o autor
#: esperado nos eventos, porque o `client` compartilhado está autenticado com ela.
NOME_DO_ANALISTA_DA_SUITE = "Analista da Suite"


def timeline(client: TestClient, incident_id: str) -> list[dict[str, Any]]:
    """Lê a timeline do incidente e devolve os eventos."""
    resposta = client.get(f"{INCIDENTS_URL}/{incident_id}/events")
    assert resposta.status_code == 200, resposta.text
    return resposta.json()["items"]


def tipos(eventos: list[dict[str, Any]]) -> list[str]:
    """Sequência de tipos de evento."""
    return [evento["eventType"] for evento in eventos]


# --------------------------------------------------------------------------- #
# O que é registrado
# --------------------------------------------------------------------------- #
def test_criacao_registra_evento(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    incidente = incident_factory()

    eventos = timeline(client, incidente["id"])

    assert tipos(eventos) == ["CREATED"]
    assert eventos[0]["toStatus"] == "ABERTO"
    assert eventos[0]["fromStatus"] is None
    # O autor do evento é quem está AUTENTICADO, não o canal que reportou.
    # `reportedBy` continua no registro como origem do chamado ("Rádio Frota
    # 12"); quem cadastrou é a analista dona do token.
    assert eventos[0]["actor"] == NOME_DO_ANALISTA_DA_SUITE
    assert incidente["reportedBy"] != eventos[0]["actor"]
    assert eventos[0]["createdAt"]


def test_transicao_registra_origem_destino_e_autor(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    incidente = incident_factory()

    resposta = client.post(
        f"{INCIDENTS_URL}/{incidente['id']}/status",
        json={"status": "EM_INVESTIGACAO", "assignedAnalyst": "Marina Duarte"},
        headers={"If-Match": f'"{incidente["version"]}"'},
    )
    assert resposta.status_code == 200

    eventos = timeline(client, incidente["id"])

    assert tipos(eventos) == ["CREATED", "STATUS_CHANGED"]
    transicao = eventos[1]
    assert transicao["fromStatus"] == "ABERTO"
    assert transicao["toStatus"] == "EM_INVESTIGACAO"
    # Quem agiu veio do token. Antes da autenticação este campo era o
    # `assignedAnalyst` do corpo: o histórico registrava quem o cliente dizia ser.
    assert transicao["actor"] == NOME_DO_ANALISTA_DA_SUITE
    # A versão que o cliente declarou esperar fica guardada: é o que permite
    # explicar depois por que uma transição foi aceita e outra recusada.
    assert transicao["payload"]["expectedVersion"] == incidente["version"]


def test_timeline_em_ordem_cronologica(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    """A timeline é lida como narrativa: o que aconteceu, e depois o que veio."""
    incidente = incident_factory()
    versao = incidente["version"]

    for destino in ("EM_INVESTIGACAO", "FECHADO"):
        resposta = client.post(
            f"{INCIDENTS_URL}/{incidente['id']}/status",
            json={"status": destino, "resolutionNotes": "Atendido no local."},
            headers={"If-Match": f'"{versao}"'},
        )
        assert resposta.status_code == 200, resposta.text
        versao = resposta.json()["version"]

    eventos = timeline(client, incidente["id"])

    assert tipos(eventos) == ["CREATED", "STATUS_CHANGED", "STATUS_CHANGED"]
    assert [evento["toStatus"] for evento in eventos] == [
        "ABERTO",
        "EM_INVESTIGACAO",
        "FECHADO",
    ]
    # O evento de fechamento guarda a justificativa registrada — é o que permite
    # reconstruir a decisão sem depender da memória de quem a tomou.
    assert eventos[2]["payload"]["resolutionNotes"] == "Atendido no local."
    instantes = [evento["createdAt"] for evento in eventos]
    assert instantes == sorted(instantes)


def test_remocao_registra_evento_e_a_timeline_continua_legivel(
    client: TestClient, admin_client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    """Soft delete promete remover sem apagar o histórico; a timeline prova."""
    incidente = incident_factory()
    # Remover exige ADMIN: a analista conduz o ciclo de vida, mas não apaga.
    assert admin_client.delete(f"{INCIDENTS_URL}/{incidente['id']}").status_code == 204

    # O detalhe responde 404 porque o incidente saiu da listagem...
    assert client.get(f"{INCIDENTS_URL}/{incidente['id']}").status_code == 404

    # ...mas a auditoria continua acessível, que é o ponto do soft delete.
    eventos = timeline(client, incidente["id"])
    assert tipos(eventos) == ["CREATED", "DELETED"]


# --------------------------------------------------------------------------- #
# O que NÃO é registrado
# --------------------------------------------------------------------------- #
def test_transicao_recusada_nao_gera_evento(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    """Auditoria que registra tentativa recusada deixa de ser auditoria de estado."""
    incidente = incident_factory()

    conflito = client.post(
        f"{INCIDENTS_URL}/{incidente['id']}/status",
        json={"status": "EM_INVESTIGACAO"},
        headers={"If-Match": '"99"'},  # versão que não existe
    )
    assert conflito.status_code == 409

    assert tipos(timeline(client, incidente["id"])) == ["CREATED"]


def test_transicao_invalida_nao_gera_evento(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    incidente = incident_factory()

    invalida = client.post(
        f"{INCIDENTS_URL}/{incidente['id']}/status",
        json={"status": "FECHADO"},  # ABERTO não vai direto para FECHADO
        headers={"If-Match": f'"{incidente["version"]}"'},
    )
    assert invalida.status_code == 422

    assert tipos(timeline(client, incidente["id"])) == ["CREATED"]


# --------------------------------------------------------------------------- #
# Casos de borda
# --------------------------------------------------------------------------- #
def test_incidente_inexistente_devolve_404_e_nao_lista_vazia(client: TestClient) -> None:
    """Lista vazia diria "não tem histórico"; a verdade é "não existe"."""
    resposta = client.get(f"{INCIDENTS_URL}/{uuid4()}/events")

    assert resposta.status_code == 404
    assert resposta.json()["error"]["code"] == "INCIDENT_NOT_FOUND"


def test_timeline_nao_e_afetada_por_mutacao_em_outro_incidente(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    primeiro = incident_factory()
    segundo = incident_factory()

    client.post(
        f"{INCIDENTS_URL}/{segundo['id']}/status",
        json={"status": "EM_INVESTIGACAO", "assignedAnalyst": "Marina Duarte"},
        headers={"If-Match": f'"{segundo["version"]}"'},
    )

    assert tipos(timeline(client, primeiro["id"])) == ["CREATED"]
    assert tipos(timeline(client, segundo["id"])) == ["CREATED", "STATUS_CHANGED"]
