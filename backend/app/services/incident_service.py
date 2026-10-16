"""Regras de aplicação do ciclo de vida dos incidentes."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from app.core.circuit_breaker import CircuitBreaker, get_circuit_breaker
from app.core.errors import (
    IncidentNotFoundError,
    InvalidStatusTransitionError,
    ServiceUnavailableError,
    VersionConflictError,
)
from app.domain.enums import IncidentStatus
from app.domain.priority import compute_priority_score, compute_sla_due_at
from app.domain.rules import (
    allowed_transitions,
    assert_transition_allowed,
    predecessors_of,
    validate_resolution_notes,
)
from app.infra.retry import RetryConfig, RetryPolicy, is_transient, run_with_retry
from app.models.base import utcnow
from app.models.incident import INITIAL_VERSION, Incident
from app.models.incident_event import IncidentEvent
from app.repositories.incident_repository import (
    IncidentFilter,
    IncidentRepository,
    encode_cursor,
)
from app.schemas.common import PageInfo
from app.schemas.incident import AppliedFilters, IncidentCreate, IncidentRead, IncidentStatusChange


def serialize_incident(incident: Incident) -> dict[str, Any]:
    """Serializa o incidente no mesmo contrato camelCase da API."""
    return IncidentRead.model_validate(incident).model_dump(mode="json", by_alias=True)


@dataclass(frozen=True, slots=True)
class IncidentPage:
    """Página de incidentes pronta para virar resposta HTTP."""

    items: list[Incident]
    page_info: PageInfo
    total: int
    applied_filters: AppliedFilters


class IncidentService:
    """Orquestra regras de domínio, repositório e contrato de saída."""

    def __init__(
        self,
        repository: IncidentRepository,
        *,
        now_provider: Callable[[], datetime] = utcnow,
        retry: RetryConfig | None = None,
        breaker: CircuitBreaker | None = None,
    ) -> None:
        """Recebe o repositório, a fonte de tempo, a política de retentativa e o disjuntor."""
        self._repository = repository
        self._now_provider = now_provider
        self._retry = retry or RetryConfig()
        self._breaker = breaker or get_circuit_breaker()

    def _execute[T](self, operation: Callable[[], T], *, policy: RetryPolicy) -> T:
        """Executa a unidade de trabalho sob o disjuntor e com retentativa.

        A ordem importa: o disjuntor decide **antes** de qualquer tentativa. Com
        o circuito aberto, a requisição é recusada sem tocar no banco — nem para
        tentar, que é o ponto de falhar rápido.
        """
        retry_after = self._breaker.check()
        if retry_after is not None:
            raise ServiceUnavailableError(
                details={"retryAfterSeconds": retry_after},
                retry_after=retry_after,
            )

        try:
            result = self._run(operation, policy=policy)
        except Exception as exc:
            if is_transient(exc):
                self._breaker.record_failure()
            else:
                # Erro de negócio, de validação ou violação de constraint: o
                # banco respondeu. Um 404 rápido é sinal de saúde, não de
                # doença, então não pode alimentar o contador de falhas.
                self._breaker.record_success()
            raise
        self._breaker.record_success()
        return result

    def _run[T](self, operation: Callable[[], T], *, policy: RetryPolicy) -> T:
        """Aplica a política de retentativa à unidade de trabalho.

        A unidade é o método inteiro, e não cada consulta: repetir uma consulta
        isolada deixaria a operação pela metade, com parte das escritas já
        aplicada e outra parte não.

        Entre as tentativas a sessão recebe `rollback()`, para a próxima começar
        de um estado limpo em vez de herdar a transação abortada.
        """
        if policy.max_attempts <= 1:
            return operation()
        return run_with_retry(
            operation,
            policy=policy,
            on_retry=lambda _exc: self._repository.rollback(),
        )

    def get(self, incident_id: UUID) -> Incident:
        """Devolve o incidente ou levanta 404."""
        return self._execute(lambda: self._require(incident_id), policy=self._retry.for_read())

    def _require(self, incident_id: UUID) -> Incident:
        """Busca o incidente pelo id ou levanta 404."""
        incident = self._repository.get_by_id(incident_id)
        if incident is None:
            raise IncidentNotFoundError(details={"id": str(incident_id)})
        return incident

    def events(self, incident_id: UUID) -> list[IncidentEvent]:
        """Timeline de auditoria do incidente, do mais antigo para o mais recente.

        Confirma que o incidente existe antes de listar. Sem isso, um id
        inexistente devolveria lista vazia, e "não existe" viraria "não tem
        histórico" — duas respostas diferentes para quem está investigando, e a
        diferença importa.
        """
        return self._execute(lambda: self._events(incident_id), policy=self._retry.for_read())

    def _events(self, incident_id: UUID) -> list[IncidentEvent]:
        """Valida a existência do incidente e devolve os eventos.

        A busca **inclui os removidos**: a timeline de um incidente com soft
        delete continua legível. Se ela sumisse junto com o incidente, "remover
        sem apagar o histórico" seria falso — e é justamente o histórico que se
        quer consultar depois.
        """
        if self._repository.get_by_id(incident_id, include_deleted=True) is None:
            raise IncidentNotFoundError(details={"id": str(incident_id)})
        return self._repository.list_events(incident_id)

    def create(self, payload: IncidentCreate) -> Incident:
        """Cria o incidente com status ABERTO, SLA e score calculados no servidor.

        Não é repetido: um `INSERT` não tem guarda natural, então uma segunda
        tentativa após um commit que o cliente não viu criaria um segundo
        incidente. Aqui a API devolve `503` e quem reenvia é o cliente, com a
        mesma `Idempotency-Key`.
        """
        return self._execute(lambda: self._insert(payload), policy=self._retry.for_insert())

    def _insert(self, payload: IncidentCreate) -> Incident:
        now = self._now_provider()
        sla_due_at = compute_sla_due_at(payload.criticality, now)
        incident = Incident(
            id=uuid4(),
            code="",
            title=payload.title,
            description=payload.description,
            category=payload.category,
            criticality=payload.criticality,
            status=IncidentStatus.ABERTO,
            latitude=payload.latitude,
            longitude=payload.longitude,
            location_label=payload.location_label,
            truck_plate=payload.truck_plate,
            driver_name=payload.driver_name,
            reported_by=payload.reported_by,
            assigned_analyst=None,
            resolution_notes=None,
            priority_score=compute_priority_score(
                category=payload.category,
                criticality=payload.criticality,
                created_at=now,
                sla_due_at=sla_due_at,
                now=now,
            ),
            sla_due_at=sla_due_at,
            version=INITIAL_VERSION,
            created_at=now,
            updated_at=now,
            closed_at=None,
            deleted_at=None,
        )
        return self._repository.create(incident)

    def list(self, filters: IncidentFilter) -> IncidentPage:
        """Lista incidentes com filtros, ordenação e paginação por cursor."""
        return self._execute(lambda: self._list(filters), policy=self._retry.for_read())

    def _list(self, filters: IncidentFilter) -> IncidentPage:
        now = self._now_provider()
        self._repository.refresh_priority_scores(now=now)
        items, total, has_next_page = self._repository.list_incidents(filters)

        next_cursor = encode_cursor(items[-1], filters.sort) if has_next_page and items else None
        page_info = PageInfo(
            next_cursor=next_cursor,
            has_next_page=has_next_page,
            limit=filters.limit,
        )
        applied = AppliedFilters(
            status=list(filters.statuses),
            criticality=list(filters.criticalities),
            category=list(filters.categories),
            search=filters.search,
            sort=filters.sort,
        )
        return IncidentPage(
            items=items,
            page_info=page_info,
            total=total,
            applied_filters=applied,
        )

    def change_status(
        self,
        incident_id: UUID,
        payload: IncidentStatusChange,
        *,
        expected_version: int,
    ) -> Incident:
        """Aplica a transição de status usando compare-and-swap no banco.

        É repetível porque o `UPDATE ... WHERE version = ?` não encontra a versão
        esperada numa segunda execução depois de um commit bem-sucedido — então
        repetir não produz efeito novo. Mas só é repetida quando o cliente
        enviou `Idempotency-Key`, a declaração de que a operação é reenviável.
        """
        return self._execute(
            lambda: self._transition(incident_id, payload, expected_version=expected_version),
            policy=self._retry.for_conditional_write(),
        )

    def _transition(
        self,
        incident_id: UUID,
        payload: IncidentStatusChange,
        *,
        expected_version: int,
    ) -> Incident:
        validate_resolution_notes(payload.status, payload.resolution_notes)

        now = self._now_provider()
        rowcount = self._repository.apply_status_transition(
            incident_id=incident_id,
            expected_version=expected_version,
            new_status=payload.status,
            allowed_sources=predecessors_of(payload.status),
            now=now,
            assigned_analyst=payload.assigned_analyst,
            resolution_notes=payload.resolution_notes,
            closed_at=now if payload.status is IncidentStatus.FECHADO else None,
        )

        if rowcount != 1:
            self._raise_transition_failure(incident_id, payload.status, expected_version)

        return self._reload_with_fresh_score(incident_id)

    def soft_delete(self, incident_id: UUID, *, expected_version: int | None) -> None:
        """Remove logicamente o incidente, opcionalmente sob lock otimista."""
        self._execute(
            lambda: self._do_soft_delete(incident_id, expected_version=expected_version),
            policy=self._retry.for_conditional_write(),
        )

    def _do_soft_delete(self, incident_id: UUID, *, expected_version: int | None) -> None:
        rowcount = self._repository.soft_delete(
            incident_id,
            expected_version=expected_version,
            now=self._now_provider(),
        )
        if rowcount == 1:
            return

        current = self._repository.get_by_id(incident_id)
        if current is None:
            raise IncidentNotFoundError(details={"id": str(incident_id)})
        if expected_version is not None and current.version != expected_version:
            raise VersionConflictError(
                details={
                    "expectedVersion": expected_version,
                    "current": serialize_incident(current),
                }
            )
        raise IncidentNotFoundError(details={"id": str(incident_id)})

    def _raise_transition_failure(
        self, incident_id: UUID, target: IncidentStatus, expected_version: int
    ) -> None:
        """Classifica a falha do CAS em 404, 409 ou 422 com o estado atual."""
        current = self._repository.get_by_id(incident_id)
        if current is None:
            raise IncidentNotFoundError(details={"id": str(incident_id)})

        if current.version != expected_version:
            raise VersionConflictError(
                details={
                    "expectedVersion": expected_version,
                    "current": serialize_incident(current),
                }
            )

        assert_transition_allowed(current.status, target)
        raise InvalidStatusTransitionError(
            f"Não é possível ir de {current.status.value} para {target.value}.",
            details={
                "from": current.status.value,
                "to": target.value,
                "allowed": [status.value for status in allowed_transitions(current.status)],
            },
        )

    def _reload_with_fresh_score(self, incident_id: UUID) -> Incident:
        """Recarrega o incidente e persiste o score recalculado."""
        incident = self._repository.get_by_id(incident_id)
        if incident is None:
            raise IncidentNotFoundError(details={"id": str(incident_id)})

        now = self._now_provider()
        score = compute_priority_score(
            category=incident.category,
            criticality=incident.criticality,
            created_at=incident.created_at,
            sla_due_at=incident.sla_due_at,
            now=now,
        )
        if score != incident.priority_score:
            self._repository.update_priority_score(incident.id, score)
            incident.priority_score = score
        return incident
