"""Testes do seed de contas de demonstração.

O seed de usuários só cria em base **vazia**, e a base da suíte nunca está
vazia: o `conftest` preserva `users` entre os testes de propósito — é o que
mantém os tokens da sessão válidos. Por isso estes testes montam um SQLite em
memória só para eles; limpar `users` na base compartilhada derrubaria a suíte
inteira.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import create_session
from app.core.tokens import hash_password, verify_password
from app.domain.accounts import INVITE_TTL_HOURS, MIN_PASSWORD_LENGTH
from app.infra.seed import DEMO_USER_COUNT, DEMO_USERS, INVITED_DEMO_USER, seed_users
from app.models.base import Base, utcnow
from app.repositories.user_repository import UserRepository

#: Domínios que não pertencem a ninguém (RFC 2606).
#:
#: É o que impede um convite de demonstração de chegar à caixa de entrada de uma
#: pessoa real: o envio por SMTP é de verdade, então o "Reenviar" clicado por
#: engano não pode ter destinatário.
DOMINIOS_RESERVADOS = ("example.com", "example.org", "example.net")

#: O domínio do **próprio produto**: as contas de demonstração que o README e o
#: edital documentam desde a primeira entrega.
#:
#: Não conta como "domínio de gente real" — o destinatário de um convite é a
#: própria central, e não a caixa de entrada de um terceiro.
DOMINIO_DO_PRODUTO = "demo.example.com"

#: A única exceção deliberada: a conta pessoal de quem apresenta.
EMAIL_PESSOAL = "alyssonaraujowork@gmail.com"

#: Papéis esperados no seed, em ordem alfabética: dois admins, quatro analistas e
#: três repórteres — as nove contas (oito ativas mais a do convite pendente).
PAPEIS_ESPERADOS = [
    "ADMIN",
    "ADMIN",
    "ANALYST",
    "ANALYST",
    "ANALYST",
    "ANALYST",
    "REPORTER",
    "REPORTER",
    "REPORTER",
]


def banco_vazio() -> Session:
    """Sessão sobre um SQLite em memória, com o schema criado na hora."""
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    return create_session(engine)


def test_seed_cria_as_contas_de_demonstracao_e_e_idempotente() -> None:
    with banco_vazio() as session:
        repository = UserRepository(session)

        assert seed_users(session) == DEMO_USER_COUNT
        assert repository.count() == DEMO_USER_COUNT

        # Rodar de novo não duplica nada — é o que permite o seed na subida da
        # API sem uma segunda conta com o mesmo e-mail.
        assert seed_users(session) == 0
        assert repository.count() == DEMO_USER_COUNT


def test_seed_grava_a_senha_derivada_e_o_papel_de_cada_conta() -> None:
    with banco_vazio() as session:
        seed_users(session)
        repository = UserRepository(session)

        for email, nome, papel, senha in DEMO_USERS:
            conta = repository.get_by_email(email)
            assert conta is not None, email
            assert conta.name == nome
            assert conta.role is papel
            assert conta.is_active is True
            # A senha entra só como hash Argon2: em texto puro, nunca.
            assert senha not in conta.password_hash
            assert conta.password_hash.startswith("$argon2")
            assert verify_password(senha, conta.password_hash)
            assert not conta.must_change_password
            # A política mínima vale também para a demonstração: uma credencial
            # que a aplicação recusaria na troca de senha seria um detalhe ruim.
            assert len(senha) >= MIN_PASSWORD_LENGTH

        papeis = sorted(conta.role.value for conta in repository.list_all())
        assert papeis == PAPEIS_ESPERADOS


def test_seed_deixa_a_conta_do_convite_pendente_com_o_admin_como_autor() -> None:
    with banco_vazio() as session:
        seed_users(session)
        repository = UserRepository(session)

        email, nome, papel = INVITED_DEMO_USER
        convidado = repository.get_by_email(email)
        # Quem assina é o primeiro `ADMIN` de `DEMO_USERS`.
        admin = repository.get_by_email("admin@demo.example.com")
        assert convidado is not None
        assert admin is not None

        assert convidado.name == nome
        assert convidado.role is papel
        # Nasce inativa, como qualquer conta criada por convite...
        assert convidado.is_active is False
        assert convidado.last_login_at is None
        # ...e sem senha definitiva: nenhuma senha digitada confere.
        assert not verify_password("marcos.logos2026", convidado.password_hash)

        # O que a tela de contas mostra como "Convite pendente" + "Reenviar".
        assert convidado.must_change_password is True
        assert convidado.invite_pending is True
        assert convidado.temp_password_hash is not None
        assert convidado.temp_password_hash != convidado.password_hash
        assert convidado.invite_expires_at is not None
        restante = convidado.invite_expires_at - utcnow()
        assert timedelta(hours=INVITE_TTL_HOURS - 1) < restante <= timedelta(hours=INVITE_TTL_HOURS)

        # O convite tem autor: a administração de contas também precisa disso.
        assert convidado.invited_by_id == admin.id
        assert admin.invite_pending is False


def test_contas_de_demonstracao_nao_usam_dominio_de_gente_real() -> None:
    """O destinatário de um convite é o produto ou um domínio reservado.

    O convite sai por SMTP de verdade (#129), então uma conta de demonstração num
    domínio de terceiro entregaria credencial na caixa de entrada de um estranho
    no primeiro "Reenviar" clicado. `demo.example.com` é o domínio do **próprio
    produto** — é para lá que o convite de demonstração vai, se for o caso —, e
    não o de gente real.
    """
    emails = [email for email, _nome, _papel, _senha in DEMO_USERS]
    emails.append(INVITED_DEMO_USER[0])
    permitidos = tuple(f"@{dominio}" for dominio in (DOMINIO_DO_PRODUTO, *DOMINIOS_RESERVADOS))

    for email in emails:
        if email == EMAIL_PESSOAL:
            continue
        assert email.endswith(permitidos), email


def test_seed_converge_banco_parcial() -> None:
    """Numa base que já tem **algumas** contas, o seed cria as que faltam.

    **Este é o teste que faltava.** A guarda anterior era
    `if repository.count() > 0: return 0` — tudo ou nada. Ela populava banco
    vazio e desistia de banco parcial. Quando a lista de contas cresceu depois de
    o seed já ter rodado contra o banco publicado, as contas novas nunca foram
    criadas: a tela de login passou a anunciar credenciais que respondiam `401`, e
    ninguém percebeu porque o seed "rodava com sucesso".

    Idempotência de verdade é chegar ao estado desejado, não pular o trabalho
    quando já existe algo.
    """
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        repository = UserRepository(session)

        # Estado parcial: só as duas primeiras contas da lista.
        parciais = DEMO_USERS[:2]
        for email, nome, papel, senha in parciais:
            repository.create(
                email=email,
                password_hash=hash_password(senha),
                name=nome,
                role=papel,
            )

        assert seed_users(session) == DEMO_USER_COUNT - len(parciais)

        emails_no_banco = {user.email for user in repository.list_all()}
        # Todas as contas da lista existem agora — inclusive as que faltavam.
        assert {email for email, *_ in DEMO_USERS} <= emails_no_banco
        assert INVITED_DEMO_USER[0] in emails_no_banco

        # As que já existiam não foram duplicadas nem reescritas.
        assert len(emails_no_banco) == DEMO_USER_COUNT

        # E rodar de novo não cria nada: o estado desejado já foi alcançado.
        assert seed_users(session) == 0
