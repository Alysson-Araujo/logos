"""Idempotência das mutações: reenvio seguro, corpo divergente e concorrência."""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient

from app.core.database import create_session
from app.core.idempotency import IDEMPOTENCY_HEADER, REPLAYED_HEADER
from app.models.base import utcnow
from app.models.idempotency_key import STATUS_COMPLETED, IdempotencyKey

INCIDENTS_URL = "/api/v1/incidents"


def payload(**overrides: Any) -> dict[str, Any]:
    """Corpo válido de criação de incidente."""
    corpo: dict[str, Any] = {
        "title": "Queda de árvore sobre a pista",
        "description": "Faixa da direita interditada no km 12.",
        "category": "BLOQUEIO_DE_PISTA",
        "criticality": "ALTA",
        "locationLabel": "BR-101 km 12, sentido sul",
        "truckPlate": "ABC1D23",
        "reportedBy": "Rádio Frota 7",
    }
    corpo.update(overrides)
    return corpo


def com_chave(chave: str) -> dict[str, str]:
    """Cabeçalhos de uma requisição idempotente."""
    return {IDEMPOTENCY_HEADER: chave}


def test_reenvio_devolve_a_mesma_resposta_sem_criar_de_novo(client: TestClient) -> None:
    chave = "cria-incidente-0001"
    corpo = payload()

    primeira = client.post(INCIDENTS_URL, json=corpo, headers=com_chave(chave))
    segunda = client.post(INCIDENTS_URL, json=corpo, headers=com_chave(chave))

    assert primeira.status_code == 201
    assert segunda.status_code == 201
    # Mesmo recurso, e não um segundo incidente.
    assert segunda.json()["id"] == primeira.json()["id"]
    assert segunda.json()["code"] == primeira.json()["code"]

    listagem = client.get(INCIDENTS_URL).json()
    assert listagem["meta"]["total"] == 1


def test_reenvio_vem_sinalizado_e_preserva_os_cabecalhos_do_contrato(
    client: TestClient,
) -> None:
    chave = "cria-incidente-0002"
    corpo = payload()

    primeira = client.post(INCIDENTS_URL, json=corpo, headers=com_chave(chave))
    segunda = client.post(INCIDENTS_URL, json=corpo, headers=com_chave(chave))

    assert segunda.headers[REPLAYED_HEADER] == "true"
    # Location e ETag fazem parte do contrato: sem eles o cliente reenviaria às
    # cegas, sem saber onde o recurso está nem em que versão ele ficou.
    assert segunda.headers["Location"] == primeira.headers["Location"]
    assert segunda.headers["ETag"] == primeira.headers["ETag"]
    assert segunda.json() == primeira.json()


def test_resposta_nova_nao_vem_marcada_como_reenvio(client: TestClient) -> None:
    resposta = client.post(INCIDENTS_URL, json=payload(), headers=com_chave("cria-incidente-0003"))
    assert resposta.status_code == 201
    assert REPLAYED_HEADER not in resposta.headers


def test_mesma_chave_com_corpo_diferente_e_recusada(client: TestClient) -> None:
    chave = "cria-incidente-0004"

    primeira = client.post(INCIDENTS_URL, json=payload(), headers=com_chave(chave))
    assert primeira.status_code == 201

    segunda = client.post(
        INCIDENTS_URL,
        json=payload(title="Outro incidente completamente diferente"),
        headers=com_chave(chave),
    )

    assert segunda.status_code == 409
    assert segunda.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    # E nada novo foi criado.
    assert client.get(INCIDENTS_URL).json()["meta"]["total"] == 1


def test_sem_chave_o_comportamento_e_o_de_sempre(client: TestClient) -> None:
    """Sem o cabeçalho, duas requisições iguais criam dois incidentes."""
    corpo = payload()
    assert client.post(INCIDENTS_URL, json=corpo).status_code == 201
    assert client.post(INCIDENTS_URL, json=corpo).status_code == 201
    assert client.get(INCIDENTS_URL).json()["meta"]["total"] == 2


def test_leitura_nao_e_afetada_pelo_cabecalho(client: TestClient) -> None:
    client.post(INCIDENTS_URL, json=payload(), headers=com_chave("cria-incidente-0005"))
    resposta = client.get(INCIDENTS_URL, headers=com_chave("cria-incidente-0005"))
    assert resposta.status_code == 200


def test_transicao_repetida_nao_avanca_a_versao_duas_vezes(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    incidente = incident_factory()
    chave = "muda-status-0001"
    cabecalhos = {
        IDEMPOTENCY_HEADER: chave,
        "If-Match": f'"{incidente["version"]}"',
    }
    url = f"{INCIDENTS_URL}/{incidente['id']}/status"
    corpo = {"status": "EM_INVESTIGACAO"}

    primeira = client.post(url, json=corpo, headers=cabecalhos)
    segunda = client.post(url, json=corpo, headers=cabecalhos)

    assert primeira.status_code == 200
    assert segunda.status_code == 200
    assert segunda.headers[REPLAYED_HEADER] == "true"
    # O ponto central: a versão não andou duas vezes. Um reenvio não é uma
    # segunda transição — se fosse, alguém perderia o lock sem motivo.
    assert segunda.json()["version"] == primeira.json()["version"]


def test_soft_delete_reenviado_devolve_204_novamente(
    admin_client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    incidente = incident_factory()
    url = f"{INCIDENTS_URL}/{incidente['id']}"
    cabecalhos = com_chave("remove-0001")

    # Remover exige ADMIN; a criação continua vindo da analista.
    primeira = admin_client.delete(url, headers=cabecalhos)
    segunda = admin_client.delete(url, headers=cabecalhos)

    assert primeira.status_code == 204
    assert segunda.status_code == 204
    assert segunda.headers.get(REPLAYED_HEADER) == "true"


def test_erro_de_validacao_libera_a_chave_para_nova_tentativa(client: TestClient) -> None:
    """Um 422 não pode consumir a chave: o cliente precisa corrigir e reenviar."""
    chave = "cria-incidente-0006"

    invalido = client.post(INCIDENTS_URL, json=payload(title=""), headers=com_chave(chave))
    assert invalido.status_code == 422

    corrigido = client.post(INCIDENTS_URL, json=payload(), headers=com_chave(chave))
    assert corrigido.status_code == 201


def test_conflito_de_versao_libera_a_chave(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    """Um 409 de lock otimista também libera a chave, mas o corpo é o mesmo."""
    incidente = incident_factory()
    chave = "muda-status-0002"
    url = f"{INCIDENTS_URL}/{incidente['id']}/status"
    corpo = {"status": "EM_INVESTIGACAO"}

    # Primeiro com a versão errada: 409 do lock otimista.
    errado = client.post(url, json=corpo, headers={IDEMPOTENCY_HEADER: chave, "If-Match": '"99"'})
    assert errado.status_code == 409
    assert errado.json()["error"]["code"] == "VERSION_CONFLICT"

    # A chave foi liberada, então a mesma chave com o mesmo corpo agora executa.
    certo = client.post(
        url,
        json=corpo,
        headers={IDEMPOTENCY_HEADER: chave, "If-Match": f'"{incidente["version"]}"'},
    )
    assert certo.status_code == 200


def test_chave_invalida_e_recusada(client: TestClient) -> None:
    com_espaco = client.post(
        INCIDENTS_URL, json=payload(), headers={IDEMPOTENCY_HEADER: "chave com espaco"}
    )
    assert com_espaco.status_code == 422
    assert com_espaco.json()["error"]["code"] == "INVALID_IDEMPOTENCY_KEY"

    longa = client.post(INCIDENTS_URL, json=payload(), headers={IDEMPOTENCY_HEADER: "x" * 121})
    assert longa.status_code == 422
    assert longa.json()["error"]["code"] == "INVALID_IDEMPOTENCY_KEY"


def test_chave_expirada_e_tratada_como_nova(client: TestClient) -> None:
    chave = "cria-incidente-expirada"
    with create_session() as session:
        session.add(
            IdempotencyKey(
                key=chave,
                request_hash="hash-de-uma-operacao-antiga",
                status=STATUS_COMPLETED,
                response_status=201,
                response_body='{"id": "resposta-antiga"}',
                expires_at=utcnow() - timedelta(seconds=1),
            )
        )
        session.commit()

    resposta = client.post(INCIDENTS_URL, json=payload(), headers=com_chave(chave))

    assert resposta.status_code == 201
    assert REPLAYED_HEADER not in resposta.headers
    assert resposta.json()["id"] != "resposta-antiga"


def test_requisicoes_simultaneas_com_a_mesma_chave_criam_um_so(client: TestClient) -> None:
    """A garantia é do banco: a chave é a chave primária, então não há corrida."""
    chave = "cria-incidente-concorrente"
    corpo = payload()

    def enviar(_: int) -> int:
        return client.post(INCIDENTS_URL, json=corpo, headers=com_chave(chave)).status_code

    with ThreadPoolExecutor(max_workers=5) as pool:
        codigos = list(pool.map(enviar, range(5)))

    # Todas as tentativas ou criaram (a primeira) ou foram recusadas por já
    # estar em processamento; nenhuma pode ter criado um segundo incidente.
    assert all(codigo in {201, 409} for codigo in codigos), codigos
    assert codigos.count(201) >= 1

    assert client.get(INCIDENTS_URL).json()["meta"]["total"] == 1
