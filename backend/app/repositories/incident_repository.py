"""Acesso a dados de incidentes: filtros, cursor keyset e lock otimista."""

from __future__ import annotations

import base64
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final, cast
from uuid import UUID

from sqlalchemy import (
    ColumnElement,
    Integer,
    case,
    delete,
    func,
    or_,
    select,
    update,
)
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import CodeGenerationError, InvalidCursorError
from app.domain.enums import (
    IncidentCategory,
    IncidentCriticality,
    IncidentStatus,
    SortOption,
)
from app.domain.priority import compute_priority_score
from app.models.incident import Incident
from app.models.incident_event import IncidentEvent
from app.schemas.incident import CursorPayload

#: Multiplicador usado para compor a chave de ordenação por criticidade.
CRITICALITY_CURSOR_MULTIPLIER: Final[int] = 100_000

#: Peso de ordenação por criticidade (fonte única entre Python e SQL).
CRITICALITY_RANK: Final[dict[IncidentCriticality, int]] = {
    IncidentCriticality.ALTA: 3,
    IncidentCriticality.MEDIA: 2,
    IncidentCriticality.BAIXA: 1,
}

MAX_CODE_ATTEMPTS: Final[int] = 5
CODE_PREFIX_TEMPLATE: Final[str] = "INC-{year}-"
CODE_DIGITS: Final[int] = 6

#: Tipos de evento da timeline de auditoria. São estáveis, como os códigos de
#: erro da API: renomear quebraria a leitura do histórico já gravado.
EVENT_CREATED: Final[str] = "CREATED"
EVENT_STATUS_CHANGED: Final[str] = "STATUS_CHANGED"
EVENT_DELETED: Final[str] = "DELETED"

_EPOCH = datetime(1970, 1, 1)
_LIKE_ESCAPE = "\\"


@dataclass(frozen=True, slots=True)
class Cursor:
    """Posição (chave de ordenação, id) da última linha devolvida."""

    key: int
    identifier: UUID


@dataclass(frozen=True, slots=True)
class IncidentFilter:
    """Filtros, ordenação e janela de paginação de uma consulta."""

    statuses: tuple[IncidentStatus, ...] = ()
    criticalities: tuple[IncidentCriticality, ...] = ()
    categories: tuple[IncidentCategory, ...] = ()
    search: str | None = None
    sort: SortOption = SortOption.PRIORITY_DESC
    limit: int = 50
    cursor: Cursor | None = None
    #: Restringe a consulta a um autor. `None` enxerga todos os incidentes.
    #: Entra em `_conditions`, que é compartilhada entre a listagem e a
    #: contagem — então o total do `meta` fica escopado junto, de graça.
    created_by: UUID | None = None


def build_code(reference: datetime, number: int) -> str:
    """Monta o código legível do incidente no formato INC-AAAA-NNNNNN."""
    prefix = CODE_PREFIX_TEMPLATE.format(year=reference.year)
    return f"{prefix}{number:0{CODE_DIGITS}d}"


def to_microseconds(value: datetime) -> int:
    """Converte um datetime em microssegundos desde a epoch, sem aritmética float."""
    naive = value.replace(tzinfo=None) if value.tzinfo is not None else value
    delta = naive - _EPOCH
    return delta.days * 86_400_000_000 + delta.seconds * 1_000_000 + delta.microseconds


def from_microseconds(value: int) -> datetime:
    """Converte microssegundos desde a epoch em datetime naive."""
    return _EPOCH + timedelta(microseconds=value)


def _criticality_rank_expression() -> ColumnElement[int]:
    """Expressão SQL equivalente ao rank de criticidade."""
    return case(
        *[
            (Incident.criticality == criticality, rank)
            for criticality, rank in CRITICALITY_RANK.items()
        ],
        else_=0,
    )


def _criticality_sort_expression() -> ColumnElement[int]:
    """Chave composta (rank da criticidade, prioridade) usada no keyset."""
    return _criticality_rank_expression() * CRITICALITY_CURSOR_MULTIPLIER + (
        Incident.priority_score
    )


def cursor_key(incident: Incident, sort: SortOption) -> int:
    """Extrai a chave de ordenação da linha para montar o próximo cursor."""
    if sort in (SortOption.CREATED_DESC, SortOption.CREATED_ASC):
        return to_microseconds(incident.created_at)
    if sort is SortOption.CRITICALITY_DESC:
        rank = CRITICALITY_RANK[incident.criticality]
        return rank * CRITICALITY_CURSOR_MULTIPLIER + incident.priority_score
    return incident.priority_score


def encode_cursor(incident: Incident, sort: SortOption) -> str:
    """Codifica o cursor em base64url seguindo o contrato {"p", "id"}."""
    payload = CursorPayload(p=cursor_key(incident, sort), id=incident.id)
    raw = payload.model_dump_json().encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(raw: str) -> Cursor:
    """Decodifica o cursor recebido na query string."""
    padded = raw + "=" * (-len(raw) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = CursorPayload.model_validate_json(decoded)
    except (ValueError, UnicodeEncodeError) as exc:
        raise InvalidCursorError(
            "Cursor inválido: não foi possível decodificar a paginação.",
            details={"cursor": raw},
        ) from exc
    return Cursor(key=payload.p, identifier=payload.id)


def _like_pattern(term: str) -> str:
    """Monta o padrão LIKE escapando curingas informados pelo usuário."""
    escaped = term.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
    escaped = escaped.replace("%", f"{_LIKE_ESCAPE}%").replace("_", f"{_LIKE_ESCAPE}_")
    return f"%{escaped}%"


class IncidentRepository:
    """Repositório de incidentes sobre uma sessão SQLAlchemy."""

    def __init__(self, session: Session) -> None:
        """Guarda a sessão que será usada em todas as operações."""
        self._session = session

    @property
    def session(self) -> Session:
        """Sessão ORM associada ao repositório."""
        return self._session

    def rollback(self) -> None:
        """Descarta a transação corrente.

        Chamado entre tentativas de uma operação repetida: sem isto a próxima
        tentativa herdaria a transação abortada e falharia antes de tentar.
        Uma conexão morta é devolvida ao pool e substituída na próxima consulta,
        porque o engine usa `pool_pre_ping`.
        """
        self._session.rollback()

    def get_by_id(self, incident_id: UUID, *, include_deleted: bool = False) -> Incident | None:
        """Busca um incidente pelo id, ignorando removidos por padrão."""
        statement = select(Incident).where(Incident.id == incident_id)
        if not include_deleted:
            statement = statement.where(Incident.deleted_at.is_(None))
        return self._session.scalars(statement).first()

    def count(self) -> int:
        """Conta todos os incidentes da base, inclusive removidos logicamente."""
        statement = select(func.count()).select_from(Incident)
        return int(self._session.scalar(statement) or 0)

    def create(self, incident: Incident, *, actor: str) -> Incident:
        """Persiste o incidente gerando um código legível e único.

        `actor` é o nome de quem está autenticado — e não `incident.reported_by`,
        que é o CANAL de origem ("Rádio Frota 12"). Os dois convivem no registro:
        o rádio reporta, a analista cadastra, e a auditoria guarda quem cadastrou.
        """
        last_error: IntegrityError | None = None
        for attempt in range(1, MAX_CODE_ATTEMPTS + 1):
            incident.code = self._next_code(incident.created_at)
            self._session.add(incident)
            try:
                self._session.flush()
            except IntegrityError as exc:
                self._session.rollback()
                last_error = exc
                if attempt == MAX_CODE_ATTEMPTS:
                    raise CodeGenerationError() from exc
                continue
            self._record_event(
                incident.id,
                event_type=EVENT_CREATED,
                to_status=incident.status,
                actor=actor,
                now=incident.created_at,
            )
            self._session.commit()
            return incident
        raise CodeGenerationError() from last_error

    def _next_code(self, reference: datetime) -> str:
        """Gera o próximo código sequencial no formato INC-AAAA-NNNNNN."""
        prefix = CODE_PREFIX_TEMPLATE.format(year=reference.year)
        suffix = func.substr(Incident.code, len(prefix) + 1)
        statement = select(func.max(func.cast(suffix, Integer))).where(
            Incident.code.like(f"{prefix}%")
        )
        current_max = self._session.scalar(statement)
        next_number = int(current_max) + 1 if current_max is not None else 1
        return build_code(reference, next_number)

    def list_incidents(self, filters: IncidentFilter) -> tuple[list[Incident], int, bool]:
        """Devolve a página, o total do filtro (sem cursor) e se há próxima página."""
        conditions = self._conditions(filters)
        total = self._count(conditions)

        statement = select(Incident).where(*conditions)
        if filters.cursor is not None:
            statement = statement.where(self._keyset_condition(filters.sort, filters.cursor))
        statement = statement.order_by(*self._order_by(filters.sort)).limit(filters.limit + 1)

        rows = list(self._session.scalars(statement).all())
        has_next_page = len(rows) > filters.limit
        return rows[: filters.limit], total, has_next_page

    def refresh_priority_scores(self, *, now: datetime) -> int:
        """Recalcula o score persistido: aging e pressão de SLA mudam com o tempo."""
        statement = select(
            Incident.id,
            Incident.category,
            Incident.criticality,
            Incident.created_at,
            Incident.sla_due_at,
            Incident.priority_score,
            Incident.updated_at,
        ).where(Incident.deleted_at.is_(None))

        updates: list[dict[str, Any]] = []
        for row in self._session.execute(statement):
            score = compute_priority_score(
                category=row.category,
                criticality=row.criticality,
                created_at=row.created_at,
                sla_due_at=row.sla_due_at,
                now=now,
            )
            if score == row.priority_score:
                continue
            updates.append({"id": row.id, "priority_score": score, "updated_at": row.updated_at})

        if not updates:
            return 0
        self._session.execute(update(Incident), updates)
        self._session.commit()
        return len(updates)

    def update_priority_score(self, incident_id: UUID, score: int) -> None:
        """Atualiza só o score de prioridade, sem tocar na versão nem em updated_at."""
        statement = (
            update(Incident)
            .where(Incident.id == incident_id, Incident.priority_score != score)
            .values(
                priority_score=score,
                updated_at=Incident.updated_at,
            )
        )
        self._session.execute(statement)
        self._session.commit()

    def apply_status_transition(
        self,
        *,
        incident_id: UUID,
        expected_version: int,
        new_status: IncidentStatus,
        allowed_sources: Sequence[IncidentStatus],
        now: datetime,
        assigned_analyst: str | None,
        resolution_notes: str | None,
        closed_at: datetime | None,
        actor: str,
        clear_assignment: bool = False,
    ) -> int:
        """Executa o compare-and-swap atômico da transição de status.

        A versão esperada e as origens permitidas são validadas na MESMA instrução:
        `WHERE id = :id AND version = :expected AND status IN (:origens)`. A comparação
        e a escrita são atômicas no banco, sem janela de corrida (TOCTOU).
        """
        # O status de origem é lido ANTES do CAS, na mesma transação: a instrução
        # atômica não tem como devolver o valor anterior. Se alguém alterar o
        # incidente entre a leitura e a escrita, o `version = :expected` da
        # própria UPDATE recusa — então o evento nunca descreve algo que não
        # aconteceu.
        from_status = self._session.scalar(
            select(Incident.status).where(
                Incident.id == incident_id,
                Incident.deleted_at.is_(None),
            )
        )

        values: dict[str, Any] = {
            "status": new_status,
            "version": Incident.version + 1,
            "updated_at": now,
        }
        if assigned_analyst is not None:
            values["assigned_analyst"] = assigned_analyst
        elif clear_assignment:
            # Voltar para ABERTO devolve o incidente à fila: sem dono.
            values["assigned_analyst"] = None
        if resolution_notes is not None:
            values["resolution_notes"] = resolution_notes
        if closed_at is not None:
            values["closed_at"] = closed_at

        statement = (
            update(Incident)
            .where(
                Incident.id == incident_id,
                Incident.version == expected_version,
                Incident.deleted_at.is_(None),
                Incident.status.in_(list(allowed_sources)),
            )
            .values(**values)
        )
        # `Session.execute` é tipado como Result; o UPDATE devolve CursorResult com rowcount.
        result = cast("CursorResult[Any]", self._session.execute(statement))
        rowcount = int(result.rowcount)
        if rowcount == 1:
            # O contexto do evento guarda o que permite explicar a decisão depois:
            # a versão que o cliente declarou esperar e a justificativa registrada.
            event_payload: dict[str, Any] = {"expectedVersion": expected_version}
            if resolution_notes is not None:
                event_payload["resolutionNotes"] = resolution_notes
            self._record_event(
                incident_id,
                event_type=EVENT_STATUS_CHANGED,
                from_status=from_status,
                to_status=new_status,
                # Quem AGIU, do token. Antes daqui vinha o `assignedAnalyst` do
                # corpo da requisição: o histórico registrava quem o cliente
                # dizia ser, e a auditoria não valia nada.
                actor=actor,
                payload=event_payload,
                now=now,
            )
            self._session.commit()
        else:
            self._session.rollback()
        return rowcount

    def soft_delete(
        self, incident_id: UUID, *, expected_version: int | None, now: datetime, actor: str
    ) -> int:
        """Marca o incidente como removido sem apagar o histórico."""
        conditions: list[ColumnElement[bool]] = [
            Incident.id == incident_id,
            Incident.deleted_at.is_(None),
        ]
        if expected_version is not None:
            conditions.append(Incident.version == expected_version)

        statement = (
            update(Incident)
            .where(*conditions)
            .values(deleted_at=now, updated_at=now, version=Incident.version + 1)
        )
        result = cast("CursorResult[Any]", self._session.execute(statement))
        rowcount = int(result.rowcount)
        if rowcount == 1:
            self._record_event(
                incident_id,
                event_type=EVENT_DELETED,
                actor=actor,
                payload={"expectedVersion": expected_version},
                now=now,
            )
            self._session.commit()
        else:
            self._session.rollback()
        return rowcount

    def list_events(self, incident_id: UUID) -> list[IncidentEvent]:
        """Timeline do incidente, do mais antigo para o mais recente.

        A ordem é cronológica porque a timeline é lida como narrativa: primeiro o
        que aconteceu, depois o que aconteceu por causa disso. O desempate por
        `id` existe porque dois eventos podem compartilhar o `created_at` — uma
        transição grava o evento com o mesmo instante que carimbou a mudança.
        """
        statement = (
            select(IncidentEvent)
            .where(IncidentEvent.incident_id == incident_id)
            .order_by(IncidentEvent.created_at.asc(), IncidentEvent.id.asc())
        )
        return list(self._session.scalars(statement).all())

    def _record_event(
        self,
        incident_id: UUID,
        *,
        event_type: str,
        now: datetime,
        from_status: str | None = None,
        to_status: str | None = None,
        actor: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        """Grava o evento de auditoria na **mesma transação** da mudança.

        Não há `commit` aqui de propósito: o evento e a mudança que ele descreve
        precisam entrar ou falhar juntos. Um evento órfão descreveria uma mudança
        que não aconteceu; uma mudança sem evento é um buraco no histórico — e é
        exatamente o buraco que a auditoria existe para não ter.
        """
        self._session.add(
            IncidentEvent(
                incident_id=incident_id,
                event_type=event_type,
                from_status=from_status,
                to_status=to_status,
                actor=actor,
                payload=payload,
                created_at=now,
            )
        )

    def clear(self) -> None:
        """Remove todos os incidentes e eventos — apoio a testes e re-seed."""
        self._session.execute(delete(IncidentEvent))
        self._session.execute(delete(Incident))
        self._session.commit()

    def _conditions(self, filters: IncidentFilter) -> list[ColumnElement[bool]]:
        """Monta as condições compartilhadas entre listagem e contagem."""
        conditions: list[ColumnElement[bool]] = [Incident.deleted_at.is_(None)]
        if filters.created_by is not None:
            conditions.append(Incident.created_by_id == filters.created_by)
        if filters.statuses:
            conditions.append(Incident.status.in_(list(filters.statuses)))
        if filters.criticalities:
            conditions.append(Incident.criticality.in_(list(filters.criticalities)))
        if filters.categories:
            conditions.append(Incident.category.in_(list(filters.categories)))
        if filters.search:
            pattern = _like_pattern(filters.search)
            conditions.append(
                or_(
                    Incident.title.ilike(pattern, escape=_LIKE_ESCAPE),
                    Incident.description.ilike(pattern, escape=_LIKE_ESCAPE),
                    Incident.code.ilike(pattern, escape=_LIKE_ESCAPE),
                    Incident.truck_plate.ilike(pattern, escape=_LIKE_ESCAPE),
                    Incident.location_label.ilike(pattern, escape=_LIKE_ESCAPE),
                )
            )
        return conditions

    def _count(self, conditions: Sequence[ColumnElement[bool]]) -> int:
        """Conta os registros que satisfazem as condições."""
        statement = select(func.count()).select_from(Incident).where(*conditions)
        return int(self._session.scalar(statement) or 0)

    def _order_by(self, sort: SortOption) -> tuple[ColumnElement[Any], ...]:
        """Ordenação determinística com o id como desempate estável."""
        if sort is SortOption.CREATED_DESC:
            return (Incident.created_at.desc(), Incident.id.desc())
        if sort is SortOption.CREATED_ASC:
            return (Incident.created_at.asc(), Incident.id.asc())
        if sort is SortOption.CRITICALITY_DESC:
            return (_criticality_sort_expression().desc(), Incident.id.desc())
        return (Incident.priority_score.desc(), Incident.id.desc())

    def _keyset_condition(self, sort: SortOption, cursor: Cursor) -> ColumnElement[bool]:
        """Compara a linha atual com o cursor, sem usar OFFSET."""
        if sort is SortOption.CREATED_ASC:
            boundary = from_microseconds(cursor.key)
            return or_(
                Incident.created_at > boundary,
                (Incident.created_at == boundary) & (Incident.id > cursor.identifier),
            )
        if sort is SortOption.CREATED_DESC:
            boundary = from_microseconds(cursor.key)
            return or_(
                Incident.created_at < boundary,
                (Incident.created_at == boundary) & (Incident.id < cursor.identifier),
            )

        if sort is SortOption.CRITICALITY_DESC:
            return or_(
                _criticality_sort_expression() < cursor.key,
                (_criticality_sort_expression() == cursor.key) & (Incident.id < cursor.identifier),
            )
        return or_(
            Incident.priority_score < cursor.key,
            (Incident.priority_score == cursor.key) & (Incident.id < cursor.identifier),
        )
