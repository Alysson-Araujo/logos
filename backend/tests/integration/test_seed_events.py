"""Testes do evento de auditoria que o seed grava junto com os incidentes.

A timeline de auditoria é uma das funcionalidades mais fortes do projeto, e ela
depende de existir **linha** em `incident_events`. O seed insere os incidentes em
bloco, com `add_all` — não passa pelo `IncidentRepository.create`, que é quem
grava o evento inicial. Sem esta cobertura, a tabela ficava vazia e o drawer
mostrava a seção de histórico em branco, sem nenhum teste falhar.

Usa um SQLite em memória, e não a base compartilhada da suíte, porque estes
testes precisam de uma base vazia de incidentes.
"""

from __future__ import annotations

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.database import create_session
from app.infra.seed import seed_incident_events, seed_incidents
from app.models.base import Base
from app.models.incident import Incident
from app.models.incident_event import IncidentEvent
from app.repositories.incident_repository import EVENT_CREATED


def banco_vazio() -> Session:
    """Sessão sobre um SQLite em memória, com o schema criado na hora."""
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return create_session(engine)


def contar_eventos(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(IncidentEvent)) or 0


def test_seed_grava_o_evento_created_de_cada_incidente() -> None:
    with banco_vazio() as session:
        criados = seed_incidents(session, count=5)
        assert criados == 5

        incidentes = session.scalars(select(Incident)).all()
        assert len(incidentes) == 5

        for incidente in incidentes:
            eventos = session.scalars(
                select(IncidentEvent).where(IncidentEvent.incident_id == incidente.id)
            ).all()
            assert len(eventos) == 1, f"{incidente.code} deveria ter exatamente um evento"

            evento = eventos[0]
            assert evento.event_type == EVENT_CREATED
            # Primeiro evento da vida do incidente: posição 1, sem origem.
            assert evento.sequence == 1
            assert evento.from_status is None
            assert evento.to_status == incidente.status
            # O autor é quem abriu, igual ao que `create` gravaria.
            assert evento.actor == incidente.reported_by
            # O evento nasce no mesmo instante do incidente, senão a timeline
            # contaria uma história que não aconteceu.
            assert evento.created_at == incidente.created_at


def test_seed_de_eventos_nao_duplica_o_que_ja_existe() -> None:
    with banco_vazio() as session:
        seed_incidents(session, count=3)
        antes = contar_eventos(session)
        assert antes == 3

        # Segunda execução: nada a fazer.
        assert seed_incident_events(session) == 0
        session.commit()
        assert contar_eventos(session) == antes


def test_converge_base_com_incidentes_sem_evento() -> None:
    """O caso real: base criada pela versão anterior do seed, sem eventos."""
    with banco_vazio() as session:
        seed_incidents(session, count=4)
        # Simula o estado que a produção tinha: incidentes, nenhum evento.
        session.query(IncidentEvent).delete()
        session.commit()
        assert contar_eventos(session) == 0

        assert seed_incident_events(session) == 4
        session.commit()

        incidentes = session.scalars(select(Incident)).all()
        assert contar_eventos(session) == len(incidentes)


def test_incidente_novo_nao_reaproveita_a_sequencia_de_outro() -> None:
    with banco_vazio() as session:
        seed_incidents(session, count=2)
        session.commit()

        incidentes = session.scalars(select(Incident)).all()
        assert len(incidentes) == 2

        # Cada incidente tem a sua própria timeline: as duas começam em 1, e a
        # restrição única é por (incident_id, sequence), não por sequence.
        posicoes = session.scalars(
            select(IncidentEvent.sequence).order_by(IncidentEvent.sequence)
        ).all()
        assert posicoes == [1, 1]
