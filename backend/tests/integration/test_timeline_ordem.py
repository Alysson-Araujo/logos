"""Ordem da timeline: determinística, e não sorteada pelo relógio.

**O defeito que este arquivo existe para não deixar voltar.** A timeline era
ordenada por `created_at` com desempate pelo `id`. O relógio do Windows tem
resolução de ~1 ms, então dois eventos gravados no mesmo milissegundo recebiam
instantes **idênticos** — e o desempate caía num UUID **aleatório**. A ordem era
sorteada justamente no caso em que importava.

O que tornava isso perigoso é que era **invisível na CI**: no Linux o relógio tem
resolução de microssegundos e o empate praticamente não ocorre. O teste passava e
a tela mentia.

Por isso os testes daqui **forçam o empate** em vez de esperar por ele: os
métodos de escrita recebem `now` por parâmetro, e passar o mesmo instante duas
vezes reproduz exatamente a condição que o Windows produz sozinho.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi.testclient import TestClient

from app.core.database import create_session
from app.domain.enums import IncidentStatus
from app.repositories.incident_repository import IncidentRepository

INCIDENTS_URL = "/api/v1/incidents"

#: Um instante qualquer, com fração de milissegundo para não parecer "redondo
#: de teste". O valor não importa: o que importa é ser **o mesmo** nas chamadas.
INSTANTE_EMPATADO = datetime(2026, 3, 10, 12, 0, 0, 500_000)


def timeline(client: TestClient, incident_id: str) -> list[dict[str, Any]]:
    """Lê a timeline do incidente e devolve os eventos, na ordem devolvida."""
    resposta = client.get(f"{INCIDENTS_URL}/{incident_id}/events")
    assert resposta.status_code == 200, resposta.text
    return resposta.json()["items"]


def transicionar(
    incident_id: str,
    *,
    expected_version: int,
    novo_status: IncidentStatus,
    origem: IncidentStatus,
    instante: datetime,
) -> int:
    """Aplica uma transição direto no repositório, com o instante sob controle."""
    with create_session() as session:
        return IncidentRepository(session).apply_status_transition(
            incident_id=UUID(incident_id),
            expected_version=expected_version,
            new_status=novo_status,
            allowed_sources=(origem,),
            now=instante,
            assigned_analyst=None,
            resolution_notes=None,
            closed_at=None,
            actor="Analista da Suite",
        )


def test_ordem_da_timeline_nao_depende_do_relogio(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    """Duas transições no mesmo instante continuam saindo na ordem em que ocorreram."""
    incidente = incident_factory()

    assert (
        transicionar(
            incidente["id"],
            expected_version=incidente["version"],
            novo_status=IncidentStatus.EM_INVESTIGACAO,
            origem=IncidentStatus.ABERTO,
            instante=INSTANTE_EMPATADO,
        )
        == 1
    )
    assert (
        transicionar(
            incidente["id"],
            expected_version=incidente["version"] + 1,
            novo_status=IncidentStatus.FECHADO,
            origem=IncidentStatus.EM_INVESTIGACAO,
            instante=INSTANTE_EMPATADO,
        )
        == 1
    )

    eventos = timeline(client, incidente["id"])

    # A asserção que o defeito quebrava: com o desempate aleatório, os dois
    # `STATUS_CHANGED` podiam sair invertidos e a narrativa ficava sem sentido
    # (fechado antes de entrar em investigação).
    assert [evento["toStatus"] for evento in eventos] == [
        "ABERTO",
        "EM_INVESTIGACAO",
        "FECHADO",
    ]


def test_ordem_e_estavel_entre_leituras(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    """Ler a timeline duas vezes devolve a mesma ordem.

    Com o desempate por UUID a ordem podia mudar entre leituras, porque o banco
    não garante ordem estável para empate — o que faria a tela "pular" ao
    recarregar.
    """
    incidente = incident_factory()

    for indice, (origem, destino) in enumerate(
        [
            (IncidentStatus.ABERTO, IncidentStatus.EM_INVESTIGACAO),
            (IncidentStatus.EM_INVESTIGACAO, IncidentStatus.FECHADO),
        ]
    ):
        transicionar(
            incidente["id"],
            expected_version=incidente["version"] + indice,
            novo_status=destino,
            origem=origem,
            instante=INSTANTE_EMPATADO,
        )

    primeira = [evento["id"] for evento in timeline(client, incidente["id"])]
    segunda = [evento["id"] for evento in timeline(client, incidente["id"])]

    assert primeira == segunda


def test_sequencia_e_por_incidente_e_comeca_em_um(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    """Cada incidente tem a própria numeração.

    Uma sequência global faria a timeline de um incidente começar em 47, o que
    não diz nada a quem lê — e vazaria quantos eventos existem na base inteira.
    """
    primeiro = incident_factory()
    segundo = incident_factory()

    eventos_do_primeiro = timeline(client, primeiro["id"])
    eventos_do_segundo = timeline(client, segundo["id"])

    assert len(eventos_do_primeiro) == 1
    assert len(eventos_do_segundo) == 1
    # Os dois começam do mesmo ponto: a numeração não é compartilhada.
    assert eventos_do_primeiro[0]["toStatus"] == eventos_do_segundo[0]["toStatus"] == "ABERTO"


def test_cada_evento_tem_posicao_propria(
    client: TestClient, incident_factory: Callable[..., dict[str, Any]]
) -> None:
    """Nenhuma posição se repete dentro do mesmo incidente.

    É a invariante que o banco também garante, por restrição de unicidade em
    `(incident_id, sequence)`. Se esta asserção falhar, a restrição derruba a
    escrita antes — o que é o comportamento desejado: falhar alto em vez de
    gravar uma timeline ambígua.
    """
    incidente = incident_factory()

    transicionar(
        incidente["id"],
        expected_version=incidente["version"],
        novo_status=IncidentStatus.EM_INVESTIGACAO,
        origem=IncidentStatus.ABERTO,
        instante=INSTANTE_EMPATADO,
    )

    with create_session() as session:
        posicoes = [
            evento.sequence
            for evento in IncidentRepository(session).list_events(UUID(incidente["id"]))
        ]

    assert posicoes == sorted(posicoes)
    assert len(set(posicoes)) == len(posicoes)
