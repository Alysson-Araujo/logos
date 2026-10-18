"""Seed idempotente com incidentes realistas em pt-BR para demonstração."""

from __future__ import annotations

import logging
import random
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from typing import Final
from uuid import uuid4

from sqlalchemy import insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import create_session
from app.core.logging import configure_logging
from app.core.tokens import hash_password
from app.domain.accounts import INVITE_TTL_HOURS, generate_temp_password
from app.domain.enums import IncidentCategory, IncidentCriticality, IncidentStatus, UserRole
from app.domain.priority import compute_priority_score, compute_sla_due_at
from app.models.base import utcnow
from app.models.incident import INITIAL_VERSION, Incident
from app.models.user import User
from app.models.vehicle import Vehicle
from app.repositories.incident_repository import IncidentRepository, build_code
from app.repositories.user_repository import UserRepository
from app.repositories.vehicle_repository import VehicleRepository

logger = logging.getLogger(__name__)

SEED_COUNT: Final[int] = 120
SEED_RANDOM_STATE = 20260211
HISTORY_WINDOW_HOURS = 72

#: Tamanho da frota que a central acompanha.
SEED_VEHICLE_COUNT: Final[int] = 5000

#: Estado próprio do sorteio da frota.
#:
#: Separado de `SEED_RANDOM_STATE` de propósito. Um `random.Random` é uma
#: **sequência**: se os veículos consumissem do mesmo gerador, os 120 incidentes
#: mudariam de placa, motorista e horário a cada execução do seed. Sorteios
#: independentes mantêm os incidentes exatamente como estão.
SEED_VEHICLE_RANDOM_STATE = 20260212

#: Letras usadas nas placas — as posições 1, 2, 3 e 5 do padrão Mercosul.
PLATE_LETTERS: Final[str] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"

#: Modelos comerciais do transporte de carga no Brasil.
VEHICLE_MODELS: Final[tuple[str, ...]] = (
    "Volvo FH 460",
    "Volvo VM 270",
    "Scania R 450",
    "Scania P 310",
    "Mercedes-Benz Actros 2651",
    "Mercedes-Benz Atego 2426",
    "Volkswagen Constellation 25.480",
    "Volkswagen Meteor 28.460",
    "Iveco S-Way 540",
    "Iveco Tector 24-280",
    "DAF XF 480",
    "MAN TGX 29.480",
    "Ford Cargo 2429",
)

#: Transportadoras fictícias. Nomes inventados de propósito: nenhuma empresa
#: real deve aparecer como dona de um caminhão num projeto de demonstração.
CARRIERS: Final[tuple[str, ...]] = (
    "Transbrasil Logística",
    "Rodoexpress Cargas",
    "Transportes Bandeirante",
    "Log Sul Transportes",
    "Carga Pesada Logística",
    "Norte Sul Transportes",
    "Expresso Guarani",
    "Rota Certa Logística",
    "Transportadora Horizonte",
    "Atlas Cargas",
    "Pampa Logística",
    "Serra Azul Transportes",
    "Planalto Cargas",
    "Litoral Logística",
)

#: Distribuição alvo: ~15% ALTA, ~35% MEDIA, ~50% BAIXA.
CRITICALITY_QUOTA: Final[tuple[tuple[IncidentCriticality, int], ...]] = (
    (IncidentCriticality.ALTA, 18),
    (IncidentCriticality.MEDIA, 42),
    (IncidentCriticality.BAIXA, 60),
)

#: Distribuição de status da amostra.
STATUS_QUOTA: Final[tuple[tuple[IncidentStatus, int], ...]] = (
    (IncidentStatus.ABERTO, 48),
    (IncidentStatus.EM_INVESTIGACAO, 30),
    (IncidentStatus.FECHADO, 30),
    (IncidentStatus.INCONCLUSIVO, 12),
)

CATEGORY_QUOTA: Final[tuple[IncidentCategory, ...]] = (
    IncidentCategory.ACIDENTE_COM_VEICULO,
    IncidentCategory.ACIDENTE_COM_VITIMAS,
    IncidentCategory.CONDICAO_CLIMATICA_ATIPICA,
    IncidentCategory.PROBLEMA_MECANICO,
    IncidentCategory.BLOQUEIO_DE_PISTA,
)

#: Contas de demonstração **ativas**: (e-mail, nome, papel, senha).
#:
#: Existem para que a aplicação publicada tenha como ser usada sem cadastro —
#: não há endpoint de registro, e cadastro aberto numa central de incidentes
#: seria um risco, não uma funcionalidade.
#:
#: Os domínios são os reservados pela RFC 2606 (`example.com`, `example.org` e
#: `example.net`) de propósito: o convite sai por SMTP de verdade (#129), e uma
#: conta de demonstração num domínio de gente real colocaria uma credencial na
#: caixa de entrada de um estranho no primeiro "Reenviar" clicado. As contas em
#: `autou.com.br` não são exceção a isso: é o domínio do **próprio produto**, o
#: das contas que o README e o edital documentam desde a primeira entrega. A única
#: exceção de verdade é a conta pessoal de quem apresenta.
DEMO_USERS: Final[tuple[tuple[str, str, UserRole, str], ...]] = (
    ("ana@autou.com.br", "Ana Paula Ribeiro", UserRole.ANALYST, "ana.logos2026"),
    ("carlos@autou.com.br", "Carlos Eduardo Lima", UserRole.ANALYST, "carlos.logos2026"),
    ("marina@autou.com.br", "Marina Souza", UserRole.REPORTER, "marina.logos2026"),
    ("admin@autou.com.br", "Administrador Logos", UserRole.ADMIN, "admin.logos2026"),
    ("alyssonaraujowork@gmail.com", "Alysson Araújo", UserRole.ANALYST, "alysson.logos2026"),
    ("carlos.menezes@example.com", "Carlos Menezes", UserRole.ADMIN, "carlos.logos2026"),
    ("renata.lima@example.org", "Renata Lima", UserRole.ANALYST, "renata.logos2026"),
    ("joana.prado@example.net", "Joana Prado", UserRole.REPORTER, "joana.logos2026"),
)

#: Conta de demonstração que nasce com **convite pendente**: (e-mail, nome, papel).
#:
#: Está aqui para a tela de contas já abrir com o estado "Convite pendente" e a
#: ação "Reenviar" — sem ninguém precisar criar a conta na hora da apresentação.
#: Nasce inativa e sem senha definitiva, como qualquer conta criada por convite.
#: O seed **não** envia e-mail nenhum: quem envia é o fluxo de administração.
INVITED_DEMO_USER: Final[tuple[str, str, UserRole]] = (
    "marcos.tavares@example.org",
    "Marcos Tavares",
    UserRole.REPORTER,
)

#: Quantas contas o seed cria: as ativas mais a do convite pendente.
DEMO_USER_COUNT: Final[int] = len(DEMO_USERS) + 1


@dataclass(frozen=True, slots=True)
class Highway:
    """Rodovia usada como origem geográfica dos incidentes fictícios."""

    name: str
    latitude: float
    longitude: float
    directions: tuple[str, ...]


HIGHWAYS: tuple[Highway, ...] = (
    Highway(
        "BR-116",
        -23.5505,
        -46.6333,
        ("São Paulo", "Curitiba", "Rio de Janeiro", "interior"),
    ),
    Highway("BR-101", -27.5949, -48.5482, ("Florianópolis", "Santos", "Curitiba", "norte")),
    Highway("SP-330", -22.3500, -47.5500, ("interior", "capital", "Ribeirão Preto")),
    Highway("BR-376", -23.4200, -51.9300, ("Curitiba", "Maringá", "litoral")),
    Highway("BR-040", -22.1000, -43.2000, ("Rio de Janeiro", "Juiz de Fora", "Brasília")),
    Highway("BR-153", -22.9000, -49.0000, ("interior", "Goiás", "Paraná")),
)

DRIVER_NAMES: tuple[str, ...] = (
    "João Batista Ferreira",
    "Maria Aparecida Souza",
    "Carlos Eduardo Lima",
    "Ana Paula Ribeiro",
    "Pedro Henrique Alves",
    "José Antônio Moreira",
    "Fernanda Cristina Dias",
    "Rafael Nogueira Pinto",
    "Juliana Prado Martins",
    "Bruno Tavares Rocha",
    "Marcos Vinícius Barbosa",
    "Patrícia Gomes Andrade",
    "Luiz Fernando Cardoso",
    "Camila Rodrigues Teixeira",
    "Sérgio Ricardo Melo",
    "Débora Ferreira Lopes",
    "Antônio Carlos Pires",
    "Vanessa Almeida Cruz",
    "Rogério Santana Braga",
    "Simone Batista Freitas",
)

REPORTERS: tuple[str, ...] = (
    "Rádio Frota 12",
    "Central 0800",
    "App Motorista",
    "Torre de Controle",
    "Painel do Veículo",
    "Concessionária Autoban",
    "Polícia Rodoviária Federal",
)

ANALYSTS: tuple[str, ...] = (
    "Ana Paula Ribeiro",
    "Carlos Eduardo Lima",
    "Marina Souza",
    "Rafael Nogueira",
    "Juliana Prado",
    "Bruno Tavares",
)

TITLE_BY_CATEGORY: dict[IncidentCategory, str] = {
    IncidentCategory.ACIDENTE_COM_VEICULO: "Colisão com veículo na pista",
    IncidentCategory.ACIDENTE_COM_VITIMAS: "Acidente com vítimas",
    IncidentCategory.CONDICAO_CLIMATICA_ATIPICA: "Condição climática atípica na pista",
    IncidentCategory.PROBLEMA_MECANICO: "Falha mecânica do veículo",
    IncidentCategory.BLOQUEIO_DE_PISTA: "Bloqueio de pista",
}

DESCRIPTION_BY_CATEGORY: dict[IncidentCategory, str] = {
    IncidentCategory.ACIDENTE_COM_VEICULO: (
        "Colisão entre carreta e veículo de passeio. Veículo permanece na faixa da direita "
        "com sinalização provisória e fluxo reduzido no trecho."
    ),
    IncidentCategory.ACIDENTE_COM_VITIMAS: (
        "Acidente com feridos atendidos no local pelo SAMU. Concessionária acionada para "
        "conter vazamento de combustível e liberar a pista."
    ),
    IncidentCategory.CONDICAO_CLIMATICA_ATIPICA: (
        "Neblina densa e pista molhada reduzem a visibilidade. Motoristas orientados por "
        "painel de mensagens variáveis a reduzir a velocidade."
    ),
    IncidentCategory.PROBLEMA_MECANICO: (
        "Caminhão com falha no sistema de freios. Equipe de manutenção deslocada para "
        "atendimento e possível transbordo de carga."
    ),
    IncidentCategory.BLOQUEIO_DE_PISTA: (
        "Pista interditada por queda de carga na faixa da esquerda. Equipe de sinalização "
        "no local e desvio indicado pelo acostamento."
    ),
}

RESOLUTION_BY_STATUS: dict[IncidentStatus, str] = {
    IncidentStatus.FECHADO: (
        "Caso encerrado após atendimento da concessionária e liberação total da pista, "
        "sem necessidade de nova intervenção."
    ),
    IncidentStatus.INCONCLUSIVO: (
        "Encerrado sem causa determinada: câmeras do trecho indisponíveis e sem registro "
        "de boletim de ocorrência no período."
    ),
}


def _expand_quota[EnumT: StrEnum](quota: tuple[tuple[EnumT, int], ...]) -> list[EnumT]:
    """Expande a cota em uma lista com os valores repetidos."""
    values: list[EnumT] = []
    for value, amount in quota:
        values.extend([value] * amount)
    return values


def _build_incidents(rng: random.Random, *, now: datetime) -> list[Incident]:
    """Monta a lista de incidentes do seed de forma determinística."""
    criticalities = _expand_quota(CRITICALITY_QUOTA)
    statuses = _expand_quota(STATUS_QUOTA)
    rng.shuffle(criticalities)
    rng.shuffle(statuses)

    incidents: list[Incident] = []
    for index in range(1, SEED_COUNT + 1):
        highway = rng.choice(HIGHWAYS)
        direction = rng.choice(highway.directions)
        km = rng.randint(1, 620)
        category = CATEGORY_QUOTA[(index - 1) % len(CATEGORY_QUOTA)]
        criticality = criticalities[index - 1]
        status = statuses[index - 1]

        created_at = now - timedelta(minutes=rng.randint(0, HISTORY_WINDOW_HOURS * 60))
        elapsed = rng.randint(20, 240)
        updated_at = min(created_at + timedelta(minutes=elapsed), now)
        sla_due_at = compute_sla_due_at(criticality, created_at)
        closed_at = (
            updated_at if status in (IncidentStatus.FECHADO, IncidentStatus.INCONCLUSIVO) else None
        )
        location_label = f"{highway.name} km {km}, sentido {direction}"
        has_position = rng.random() > 0.15

        incident = Incident(
            id=uuid4(),
            code=build_code(created_at, index),
            title=f"{TITLE_BY_CATEGORY[category]} - {location_label}"[:120],
            description=DESCRIPTION_BY_CATEGORY[category],
            category=category,
            criticality=criticality,
            status=status,
            latitude=round(highway.latitude + rng.uniform(-1.5, 1.5), 5) if has_position else None,
            longitude=(
                round(highway.longitude + rng.uniform(-1.5, 1.5), 5) if has_position else None
            ),
            location_label=location_label,
            truck_plate=(
                f"{rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"
                f"{rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"
                f"{rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"
                f"{rng.randint(0, 9)}"
                f"{rng.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ')}"
                f"{rng.randint(0, 9)}{rng.randint(0, 9)}"
            ),
            driver_name=rng.choice(DRIVER_NAMES),
            reported_by=rng.choice(REPORTERS),
            assigned_analyst=(
                rng.choice(ANALYSTS) if status is not IncidentStatus.ABERTO else None
            ),
            resolution_notes=RESOLUTION_BY_STATUS.get(status),
            priority_score=compute_priority_score(
                category=category,
                criticality=criticality,
                created_at=created_at,
                sla_due_at=sla_due_at,
                now=now,
            ),
            sla_due_at=sla_due_at,
            version=rng.randint(INITIAL_VERSION, 4),
            created_at=created_at,
            updated_at=updated_at,
            closed_at=closed_at,
            deleted_at=None,
        )
        incidents.append(incident)
    return incidents


def seed_incidents(session: Session, *, count: int = SEED_COUNT) -> int:
    """Cria os incidentes de demonstração apenas em base vazia (idempotente)."""
    repository = IncidentRepository(session)
    if repository.count() > 0:
        return 0

    rng = random.Random(SEED_RANDOM_STATE)
    now = utcnow()
    incidents = _build_incidents(rng, now=now)[:count]
    session.add_all(incidents)
    session.commit()
    return len(incidents)


def seed_users(session: Session) -> int:
    """Cria as contas de demonstração apenas em base vazia (idempotente).

    As senhas seguem o MESMO padrão para todas as contas ativas:
    `<primeiro>.logos2026`, todas acima do mínimo de 12 caracteres da política.
    Uma credencial de demonstração que a própria aplicação recusaria na troca de
    senha seria um detalhe ruim de se ver no vídeo.

    A conta do convite pendente entra por último porque precisa de um
    administrador já criado como autor do convite (`invited_by_id` é chave
    estrangeira para `users`, e a lista de contas mostra quem convidou).
    """
    repository = UserRepository(session)
    if repository.count() > 0:
        return 0

    criados: list[User] = [
        repository.create(
            email=email,
            password_hash=hash_password(senha),
            name=nome,
            role=papel,
        )
        for email, nome, papel, senha in DEMO_USERS
    ]

    # Sem administrador não há quem assine o convite: `DEMO_USERS` precisa de um
    # `ADMIN`, e falhar aqui é melhor do que gravar autoria errada. Havendo mais
    # de um, assina o primeiro da lista (`admin@autou.com.br`).
    admin = next(user for user in criados if user.role is UserRole.ADMIN)

    email, nome, papel = INVITED_DEMO_USER
    repository.create(
        email=email,
        # A conta ainda não tem senha definitiva. Gravar o hash de um valor
        # aleatório descartado garante que NENHUMA senha digitada confira —
        # mesmo critério de `UserService.create_user`.
        password_hash=hash_password(secrets.token_urlsafe(32)),
        name=nome,
        role=papel,
        is_active=False,
        temp_password_hash=hash_password(generate_temp_password()),
        invite_expires_at=utcnow() + timedelta(hours=INVITE_TTL_HOURS),
        invited_by_id=admin.id,
    )
    return DEMO_USER_COUNT


def _build_plate(rng: random.Random) -> str:
    """Gera uma placa no padrão Mercosul (`AAA1A23`).

    O padrão Mercosul, e não o antigo (`AAA1234`), porque é o que está em
    circulação desde 2018 — uma frota cadastrada hoje usa este formato. O
    validador do incidente aceita os dois, então uma placa antiga que apareça
    continua sendo aceita.
    """
    return (
        f"{rng.choice(PLATE_LETTERS)}{rng.choice(PLATE_LETTERS)}{rng.choice(PLATE_LETTERS)}"
        f"{rng.randint(0, 9)}"
        f"{rng.choice(PLATE_LETTERS)}"
        f"{rng.randint(0, 9)}{rng.randint(0, 9)}"
    )


def _build_vehicles(rng: random.Random, *, count: int, now: datetime) -> list[dict[str, object]]:
    """Monta as linhas da frota, com placas únicas.

    O padrão Mercosul tem ~457 milhões de combinações, então colisões são raras:
    5.000 sorteios produzem, em média, menos de uma. O conjunto de controle
    existe para esse caso raro — e para deixar a unicidade explícita, já que a
    coluna é `unique` e uma colisão derrubaria o `commit` inteiro.

    Devolve dicionários, e não objetos ORM, porque `seed_vehicles` os entrega ao
    caminho de inserção em lote do SQLAlchemy.
    """
    vistas: set[str] = set()
    linhas: list[dict[str, object]] = []
    while len(linhas) < count:
        placa = _build_plate(rng)
        if placa in vistas:
            continue
        vistas.add(placa)
        linhas.append(
            {
                "id": uuid4(),
                "plate": placa,
                "model": rng.choice(VEHICLE_MODELS),
                "carrier": rng.choice(CARRIERS),
                "created_at": now,
                "updated_at": now,
            }
        )
    return linhas


def seed_vehicles(session: Session, *, count: int = SEED_VEHICLE_COUNT) -> int:
    """Cria a frota de demonstração apenas em base vazia (idempotente).

    Usa `insert()` com uma lista, e **não** `add_all`, por causa do volume: são
    5.000 linhas contra um banco remoto. O caminho em lote do SQLAlchemy agrupa
    as linhas em poucos comandos; 5.000 INSERTs individuais pagariam a latência
    da rede 5.000 vezes — minutos em vez de segundos.
    """
    repository = VehicleRepository(session)
    if repository.count() > 0:
        return 0

    rng = random.Random(SEED_VEHICLE_RANDOM_STATE)
    linhas = _build_vehicles(rng, count=count, now=utcnow())
    session.execute(insert(Vehicle), linhas)
    session.commit()
    return len(linhas)


def main() -> None:
    """Executa o seed manualmente (`python -m app.infra.seed`).

    As tabelas precisam existir antes: o schema vem do Alembic
    (`alembic upgrade head`), e nao de `create_all`.
    """
    configure_logging(get_settings().log_level)
    with create_session() as session:
        usuarios = seed_users(session)
        created = seed_incidents(session)
        frota = seed_vehicles(session)
    logger.info(
        "seed finalizado: %s usuarios, %s incidentes e %s veiculos criados",
        usuarios,
        created,
        frota,
    )


if __name__ == "__main__":
    main()
