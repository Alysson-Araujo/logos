"""Testes da matriz de permissões.

A matriz é verificada **inteira**, papel por papel e permissão por permissão. É
o ganho de mantê-la num lugar só: um buraco aparece aqui, e não meses depois na
forma de uma rota que ninguém protegeu.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.core.errors import InsufficientRoleError
from app.domain.enums import UserRole
from app.domain.identity import Actor
from app.domain.permissions import (
    PERMISSIONS_BY_ROLE,
    Permission,
    ensure_permission,
    has_permission,
    visibility_scope,
)

#: Matriz declarada como ESPERADO, e não importada do código: um teste que lê a
#: própria fonte que verifica não verifica nada.
MATRIZ_ESPERADA: dict[UserRole, set[Permission]] = {
    UserRole.REPORTER: {Permission.CREATE_INCIDENT},
    UserRole.ANALYST: {
        Permission.CREATE_INCIDENT,
        Permission.SEE_EVERY_INCIDENT,
        Permission.TRANSITION_INCIDENT,
    },
    UserRole.ADMIN: set(Permission),
}


def ator(papel: UserRole) -> Actor:
    """Monta um ator com o papel informado."""
    return Actor(id=uuid4(), name=f"Ator {papel.value}", role=papel)


class TestMatriz:
    """Quem pode o quê."""

    @pytest.mark.parametrize("papel", list(UserRole))
    @pytest.mark.parametrize("permissao", list(Permission))
    def test_matriz_completa(self, papel: UserRole, permissao: Permission) -> None:
        esperado = permissao in MATRIZ_ESPERADA[papel]
        assert has_permission(papel, permissao) is esperado

    def test_todo_papel_conhecido_tem_entrada_na_matriz(self) -> None:
        # Um papel novo sem entrada explodiria com KeyError em produção.
        assert set(PERMISSIONS_BY_ROLE) == set(UserRole)

    def test_apenas_admin_remove(self) -> None:
        # Remover é irreversível pela API: não há endpoint de restauração.
        quem_remove = [
            papel for papel in UserRole if has_permission(papel, Permission.DELETE_INCIDENT)
        ]
        assert quem_remove == [UserRole.ADMIN]

    def test_reporter_nao_conduz_ciclo_de_vida(self) -> None:
        assert not has_permission(UserRole.REPORTER, Permission.TRANSITION_INCIDENT)
        assert has_permission(UserRole.ANALYST, Permission.TRANSITION_INCIDENT)

    def test_reporter_enxerga_apenas_o_que_criou(self) -> None:
        assert not has_permission(UserRole.REPORTER, Permission.SEE_EVERY_INCIDENT)


class TestVerificacao:
    """`ensure_permission` e o escopo de visibilidade."""

    @pytest.mark.parametrize("papel", list(UserRole))
    def test_permissao_concedida_nao_levanta(self, papel: UserRole) -> None:
        for permissao in MATRIZ_ESPERADA[papel]:
            ensure_permission(ator(papel), permissao)

    def test_permissao_negada_levanta_403_com_contexto(self) -> None:
        with pytest.raises(InsufficientRoleError) as erro:
            ensure_permission(ator(UserRole.REPORTER), Permission.DELETE_INCIDENT)

        assert erro.value.status_code == 403
        assert erro.value.code == "INSUFFICIENT_ROLE"
        assert erro.value.details is not None
        assert erro.value.details["role"] == "REPORTER"
        assert erro.value.details["required"] == "DELETE_INCIDENT"

    def test_escopo_de_quem_ve_tudo_e_nulo(self) -> None:
        # `None` na consulta significa "sem filtro de autor", e não "autor nulo".
        assert visibility_scope(ator(UserRole.ANALYST)) is None
        assert visibility_scope(ator(UserRole.ADMIN)) is None

    def test_escopo_de_quem_ve_pouco_e_o_proprio_id(self) -> None:
        reporter = ator(UserRole.REPORTER)
        assert visibility_scope(reporter) == reporter.id
