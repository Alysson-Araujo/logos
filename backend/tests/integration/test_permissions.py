"""Testes de integração de permissão por papel e autoria dos eventos.

Duas garantias, e as duas nasceram da autenticação:

1. **Cada papel enxerga e faz apenas o que lhe cabe.** Antes, qualquer pessoa na
   internet listava, fechava e removia incidentes.
2. **O autor registrado na auditoria é quem realmente agiu.** Antes, o campo
   `actor` era um texto do corpo da requisição — o histórico registrava quem o
   cliente dizia ser, e não valia nada.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi.testclient import TestClient

INCIDENTS_URL = "/api/v1/incidents"

#: Nomes das contas da suíte (ver `CONTAS_DA_SUITE` no conftest).
NOME_DO_ANALISTA = "Analista da Suite"
NOME_DO_REPORTER = "Reporter da Suite"
NOME_DO_ADMIN = "Admin da Suite"


def criar(client: TestClient, **overrides: Any) -> dict[str, Any]:
    """Cria um incidente autenticado pelo cliente informado."""
    payload: dict[str, Any] = {
        "title": "Colisão com veículo na pista",
        "category": "ACIDENTE_COM_VEICULO",
        "criticality": "MEDIA",
        "reportedBy": "Rádio Frota 12",
    }
    payload.update(overrides)
    resposta = client.post(INCIDENTS_URL, json=payload)
    assert resposta.status_code == 201, resposta.text
    return resposta.json()


def timeline(client: TestClient, incident_id: str) -> list[dict[str, Any]]:
    """Lê a timeline e devolve os eventos."""
    resposta = client.get(f"{INCIDENTS_URL}/{incident_id}/events")
    assert resposta.status_code == 200, resposta.text
    return resposta.json()["items"]


class TestEscopoDeVisibilidade:
    """REPORTER vê apenas o que criou; ANALYST e ADMIN veem tudo."""

    def test_reporter_lista_apenas_os_proprios(
        self, client: TestClient, reporter_client: TestClient
    ) -> None:
        do_analista = criar(client)
        do_reporter = criar(reporter_client, title="Pane do reporter")

        vistos = [item["id"] for item in reporter_client.get(INCIDENTS_URL).json()["items"]]

        assert vistos == [do_reporter["id"]]
        assert do_analista["id"] not in vistos

    def test_analista_ve_o_incidente_do_reporter(
        self, client: TestClient, reporter_client: TestClient
    ) -> None:
        do_reporter = criar(reporter_client)

        assert client.get(f"{INCIDENTS_URL}/{do_reporter['id']}").status_code == 200

    def test_reporter_nao_ve_incidente_de_outro(
        self, client: TestClient, reporter_client: TestClient
    ) -> None:
        do_analista = criar(client)
        resposta = reporter_client.get(f"{INCIDENTS_URL}/{do_analista['id']}")

        # 404 e não 403: responder "existe, mas não é seu" revelaria a existência
        # de um registro que a pessoa não pode ver.
        assert resposta.status_code == 404
        assert resposta.json()["error"]["code"] == "INCIDENT_NOT_FOUND"

    def test_reporter_nao_le_a_timeline_de_outro(
        self, client: TestClient, reporter_client: TestClient
    ) -> None:
        do_analista = criar(client)
        resposta = reporter_client.get(f"{INCIDENTS_URL}/{do_analista['id']}/events")

        # A timeline conta quem fez o quê: entregá-la vazaria o mesmo conteúdo
        # por outra porta.
        assert resposta.status_code == 404

    def test_kpis_do_reporter_contam_apenas_os_proprios(
        self, client: TestClient, reporter_client: TestClient
    ) -> None:
        criar(client)
        criar(client)
        criar(reporter_client)

        listagem = reporter_client.get(f"{INCIDENTS_URL}?limit=1").json()

        # O escopo entra na mesma condição usada pela contagem, então o total do
        # `meta` — de onde os KPIs do topo saem — fica escopado de graça.
        assert listagem["meta"]["total"] == 1

    def test_admin_ve_tudo(self, client: TestClient, admin_client: TestClient) -> None:
        criar(client)
        criar(client)

        assert admin_client.get(f"{INCIDENTS_URL}?limit=1").json()["meta"]["total"] == 2


class TestPermissoesDeEscrita:
    """Quem pode criar, transicionar e remover."""

    def test_todos_os_papeis_criam(self, reporter_client: TestClient) -> None:
        assert criar(reporter_client)["id"]

    def test_reporter_nao_transiciona(
        self, reporter_client: TestClient, incident_factory: Callable[..., dict[str, Any]]
    ) -> None:
        do_reporter = criar(reporter_client)
        resposta = reporter_client.post(
            f"{INCIDENTS_URL}/{do_reporter['id']}/status",
            json={"status": "EM_INVESTIGACAO"},
            headers={"If-Match": f'"{do_reporter["version"]}"'},
        )

        assert resposta.status_code == 403
        assert resposta.json()["error"]["code"] == "INSUFFICIENT_ROLE"
        assert resposta.json()["error"]["details"]["required"] == "TRANSITION_INCIDENT"

    def test_reporter_nao_remove(self, reporter_client: TestClient) -> None:
        do_reporter = criar(reporter_client)
        resposta = reporter_client.delete(f"{INCIDENTS_URL}/{do_reporter['id']}")

        assert resposta.status_code == 403
        assert resposta.json()["error"]["code"] == "INSUFFICIENT_ROLE"

    def test_analista_transiciona(
        self, client: TestClient, incident_factory: Callable[..., dict[str, Any]]
    ) -> None:
        incidente = incident_factory()
        resposta = client.post(
            f"{INCIDENTS_URL}/{incidente['id']}/status",
            json={"status": "EM_INVESTIGACAO"},
            headers={"If-Match": f'"{incidente["version"]}"'},
        )

        assert resposta.status_code == 200

    def test_analista_nao_remove(
        self, client: TestClient, incident_factory: Callable[..., dict[str, Any]]
    ) -> None:
        incidente = incident_factory()
        resposta = client.delete(f"{INCIDENTS_URL}/{incidente['id']}")

        # A analista conduz o ciclo de vida inteiro, mas não apaga: remover é
        # irreversível pela API.
        assert resposta.status_code == 403

    def test_admin_remove(self, admin_client: TestClient) -> None:
        do_admin = criar(admin_client)
        assert admin_client.delete(f"{INCIDENTS_URL}/{do_admin['id']}").status_code == 204


class TestAutoriaDosEventos:
    """O autor registrado é quem agiu, e não quem o cliente disse ser."""

    def test_criacao_registra_quem_cadastrou(self, client: TestClient) -> None:
        incidente = criar(client, reportedBy="Central 0800")

        [evento] = timeline(client, incidente["id"])

        # O canal de origem continua no registro (`reportedBy`), mas o autor do
        # evento é quem está autenticado.
        assert evento["actor"] == NOME_DO_ANALISTA
        assert incidente["reportedBy"] == "Central 0800"

    def test_transicao_ignora_o_analista_declarado_no_corpo(
        self, client: TestClient, incident_factory: Callable[..., dict[str, Any]]
    ) -> None:
        incidente = incident_factory()

        client.post(
            f"{INCIDENTS_URL}/{incidente['id']}/status",
            json={"status": "EM_INVESTIGACAO", "assignedAnalyst": "Marina Duarte"},
            headers={"If-Match": f'"{incidente["version"]}"'},
        )

        eventos = timeline(client, incidente["id"])
        transicao = eventos[-1]

        # Antes da autenticação, este campo vinha do corpo da requisição: quem
        # enviasse `assignedAnalyst: "Marina Duarte"` aparecia no histórico como
        # se fosse ela.
        assert transicao["actor"] == NOME_DO_ANALISTA
        assert transicao["actor"] != "Marina Duarte"

    def test_remocao_registra_o_admin(
        self,
        client: TestClient,
        admin_client: TestClient,
        incident_factory: Callable[..., dict[str, Any]],
    ) -> None:
        incidente = incident_factory()
        admin_client.delete(f"{INCIDENTS_URL}/{incidente['id']}")

        eventos = timeline(client, incidente["id"])

        assert eventos[-1]["eventType"] == "DELETED"
        assert eventos[-1]["actor"] == NOME_DO_ADMIN

    def test_cada_papel_aparece_com_o_proprio_nome(
        self, client: TestClient, reporter_client: TestClient
    ) -> None:
        do_reporter = criar(reporter_client)
        do_analista = criar(client)

        assert timeline(reporter_client, do_reporter["id"])[0]["actor"] == NOME_DO_REPORTER
        assert timeline(client, do_analista["id"])[0]["actor"] == NOME_DO_ANALISTA


class TestResponsavelDerivado:
    """`assigned_analyst` passa a ser consequência da ação, não um campo de texto."""

    def test_assumir_a_investigacao_atribui_ao_autor(
        self, client: TestClient, incident_factory: Callable[..., dict[str, Any]]
    ) -> None:
        incidente = incident_factory()
        assert incidente["assignedAnalyst"] is None

        resposta = client.post(
            f"{INCIDENTS_URL}/{incidente['id']}/status",
            json={"status": "EM_INVESTIGACAO"},
            headers={"If-Match": f'"{incidente["version"]}"'},
        )

        assert resposta.json()["assignedAnalyst"] == NOME_DO_ANALISTA

    def test_devolver_para_a_fila_limpa_o_responsavel(
        self, client: TestClient, incident_factory: Callable[..., dict[str, Any]]
    ) -> None:
        incidente = incident_factory()
        assumido = client.post(
            f"{INCIDENTS_URL}/{incidente['id']}/status",
            json={"status": "EM_INVESTIGACAO"},
            headers={"If-Match": f'"{incidente["version"]}"'},
        ).json()
        assert assumido["assignedAnalyst"] == NOME_DO_ANALISTA

        devolvido = client.post(
            f"{INCIDENTS_URL}/{incidente['id']}/status",
            json={"status": "ABERTO"},
            headers={"If-Match": f'"{assumido["version"]}"'},
        ).json()

        # Voltou para a fila: não tem dono.
        assert devolvido["assignedAnalyst"] is None

    def test_fechar_preserva_quem_conduziu(
        self, client: TestClient, incident_factory: Callable[..., dict[str, Any]]
    ) -> None:
        incidente = incident_factory()
        assumido = client.post(
            f"{INCIDENTS_URL}/{incidente['id']}/status",
            json={"status": "EM_INVESTIGACAO"},
            headers={"If-Match": f'"{incidente["version"]}"'},
        ).json()

        fechado = client.post(
            f"{INCIDENTS_URL}/{incidente['id']}/status",
            json={"status": "FECHADO", "resolutionNotes": "Atendido no local."},
            headers={"If-Match": f'"{assumido["version"]}"'},
        ).json()

        assert fechado["assignedAnalyst"] == NOME_DO_ANALISTA
