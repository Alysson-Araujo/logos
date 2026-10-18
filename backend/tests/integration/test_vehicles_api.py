"""Testes de integração da busca de placas da frota."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import insert

from app.core.database import create_session
from app.models.base import utcnow
from app.models.vehicle import Vehicle

VEHICLES_URL = "/api/v1/vehicles"


def _povoar(placas: list[str]) -> None:
    """Insere veículos direto pelo banco, sem passar pela API.

    A frota não tem rota de escrita — quem a popula é o `seed`. Nos testes,
    gravar pelo banco é o caminho honesto: não existe endpoint para isso, e
    criar um só para o teste seria testar uma rota que a aplicação não tem.
    """
    agora = utcnow()
    with create_session() as session:
        session.execute(
            insert(Vehicle),
            [
                {
                    "id": uuid4(),
                    "plate": placa,
                    "model": "Volvo FH 460",
                    "carrier": "Transbrasil Logística",
                    "created_at": agora,
                    "updated_at": agora,
                }
                for placa in placas
            ],
        )
        session.commit()


def test_sem_token_recusa(anonymous_client: TestClient) -> None:
    """A frota é dado do negócio, não catálogo público como `/meta/enums`."""
    assert anonymous_client.get(f"{VEHICLES_URL}?q=ABC").status_code == 401


def test_frota_vazia_devolve_lista_vazia(client: TestClient) -> None:
    """Base sem frota não é erro: é lista vazia com total zero."""
    resposta = client.get(VEHICLES_URL)
    assert resposta.status_code == 200
    assert resposta.json() == {"items": [], "total": 0}


def test_busca_por_prefixo(client: TestClient) -> None:
    """`ABC` traz as placas que começam com ABC, e só elas."""
    _povoar(["ABC1D23", "ABC9Y74", "XYZ4B12"])
    corpo = client.get(f"{VEHICLES_URL}?q=ABC").json()
    assert [item["plate"] for item in corpo["items"]] == ["ABC1D23", "ABC9Y74"]
    assert corpo["total"] == 3


def test_prefixo_nao_casa_no_meio_da_placa(client: TestClient) -> None:
    """`ABC` não pode trazer `XABC123`.

    A busca é por começo, não por trecho: uma busca por substring encheria a
    lista de sugestões sem relação com o que a pessoa está digitando.
    """
    _povoar(["XABC123"])
    assert client.get(f"{VEHICLES_URL}?q=ABC").json()["items"] == []


def test_caixa_baixa_e_normalizada(client: TestClient) -> None:
    """Ninguém digita placa com Caps Lock ligado."""
    _povoar(["ABC1D23"])
    assert len(client.get(f"{VEHICLES_URL}?q=abc").json()["items"]) == 1


def test_espacos_em_volta_sao_ignorados(client: TestClient) -> None:
    """Colar uma placa com espaço junto não pode zerar a busca."""
    _povoar(["ABC1D23"])
    assert len(client.get(f"{VEHICLES_URL}?q=%20ABC%20").json()["items"]) == 1


def test_limite_e_respeitado(client: TestClient) -> None:
    _povoar(["ABC1D23", "ABC2E34", "ABC3F45"])
    assert len(client.get(f"{VEHICLES_URL}?q=ABC&limit=2").json()["items"]) == 2


def test_limite_acima_do_teto_e_recusado(client: TestClient) -> None:
    """Teto de 25: sem ele, um `limit=100000` viraria varredura da frota."""
    assert client.get(f"{VEHICLES_URL}?limit=26").status_code == 422


def test_limite_abaixo_do_minimo_e_recusado(client: TestClient) -> None:
    assert client.get(f"{VEHICLES_URL}?limit=0").status_code == 422


def test_total_e_o_tamanho_da_frota_e_nao_da_pagina(client: TestClient) -> None:
    """A interface precisa do universo para dizer "8 de 5.000".

    Uma lista de 8 sem contexto parece a frota inteira — e o autocomplete perde
    a informação de que está filtrando.
    """
    _povoar(["ABC1D23", "XYZ4B12", "QQQ7Z88"])
    corpo = client.get(f"{VEHICLES_URL}?q=ABC&limit=1").json()
    assert len(corpo["items"]) == 1
    assert corpo["total"] == 3


def test_por_cento_digitado_e_texto_e_nao_curinga(client: TestClient) -> None:
    """`%` é o curinga do `LIKE`; digitado, tem que ser literal.

    Sem o escape, digitar `%` devolveria a frota inteira — sugestões sem nenhuma
    relação com o que a pessoa digitou.
    """
    _povoar(["ABC1D23", "XYZ4B12", "QQQ7Z88"])
    assert client.get(f"{VEHICLES_URL}?q=%25").json()["items"] == []


def test_sublinhado_digitado_e_texto_e_nao_curinga(client: TestClient) -> None:
    """`_` casa um caractere qualquer no `LIKE`; aqui tem que ser literal."""
    _povoar(["ABC1D23"])
    assert client.get(f"{VEHICLES_URL}?q=_").json()["items"] == []


def test_reporter_tambem_consulta(reporter_client: TestClient) -> None:
    """Quem registra incidente é quem mais precisa da sugestão.

    `REPORTER` só tem `CREATE_INCIDENT`. Se a frota exigisse outra permissão, o
    autocomplete ficaria indisponível justamente para quem digita a placa.
    """
    _povoar(["ABC1D23"])
    assert reporter_client.get(f"{VEHICLES_URL}?q=ABC").status_code == 200


def test_ordem_estavel_por_placa(client: TestClient) -> None:
    """Ordenado por placa: duas buscas iguais devolvem a mesma lista.

    Sem `ORDER BY`, o banco pode devolver as linhas em ordem diferente a cada
    consulta — e a lista de sugestões "pularia" enquanto a pessoa digita.
    """
    _povoar(["QQQ7Z88", "ABC9Y74", "ABC1D23"])
    corpo = client.get(f"{VEHICLES_URL}?q=ABC").json()
    assert [item["plate"] for item in corpo["items"]] == ["ABC1D23", "ABC9Y74"]


def test_campos_de_confirmacao_vem_preenchidos(client: TestClient) -> None:
    """Placa identifica; modelo e transportadora CONFIRMAM a escolha."""
    _povoar(["ABC1D23"])
    item = client.get(f"{VEHICLES_URL}?q=ABC").json()["items"][0]
    assert item["model"] == "Volvo FH 460"
    assert item["carrier"] == "Transbrasil Logística"
    assert set(item) == {"id", "plate", "model", "carrier"}
