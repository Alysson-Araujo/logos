"""Endpoints de autenticação: login, logout, identidade e troca de senha."""

from __future__ import annotations

from typing import Final

from fastapi import APIRouter, Response, status

from app.api.deps import AuthServiceDep, CurrentClaims, CurrentUser
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    LoginResponse,
    UserRead,
)
from app.schemas.common import ErrorResponse

AUTH_RESPONSES: Final[dict[int | str, dict[str, object]]] = {
    401: {"model": ErrorResponse, "description": "Credencial ausente, inválida ou vencida"},
    403: {"model": ErrorResponse, "description": "Perfil sem permissão"},
    422: {"model": ErrorResponse, "description": "Corpo inválido"},
    429: {"model": ErrorResponse, "description": "Teto de requisições excedido"},
    503: {"model": ErrorResponse, "description": "Serviço indisponível"},
}

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Autentica e emite o token de acesso",
    description=(
        "Confere as credenciais e devolve o token. E-mail inexistente, senha "
        "incorreta e conta desativada produzem a MESMA resposta, para não "
        "revelar quais e-mails existem."
    ),
    responses={401: AUTH_RESPONSES[401], 422: AUTH_RESPONSES[422], 429: AUTH_RESPONSES[429]},
)
def login(payload: LoginRequest, service: AuthServiceDep) -> LoginResponse:
    """Autentica o usuário e devolve o token de acesso."""
    sessao = service.login(email=payload.email, password=payload.password)

    # `lastLoginAt` é o acesso ANTERIOR: o serviço já gravou o de agora, então
    # sobrescrevemos com o valor lido antes da gravação. Devolver "agora" faria
    # a interface mostrar "último acesso: agora", que não informa nada.
    usuario = UserRead.model_validate(sessao.user).model_copy(
        update={"last_login_at": sessao.previous_login_at}
    )

    return LoginResponse(
        access_token=sessao.token.token,
        token_type=sessao.token_type,
        expires_in=sessao.token.expires_in,
        user=usuario,
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Encerra a sessão atual",
    description=(
        "Revoga o token apresentado. Sem isso, sair da aplicação seria apenas o "
        "cliente esquecer o token, e um token capturado continuaria valendo até "
        "vencer."
    ),
    responses={401: AUTH_RESPONSES[401], 429: AUTH_RESPONSES[429], 503: AUTH_RESPONSES[503]},
)
def logout(claims: CurrentClaims, service: AuthServiceDep) -> Response:
    """Revoga o token atual."""
    service.logout(jti=claims.jti, expires_at=claims.expires_at)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/me",
    response_model=UserRead,
    summary="Devolve o usuário autenticado",
    responses={401: AUTH_RESPONSES[401], 429: AUTH_RESPONSES[429], 503: AUTH_RESPONSES[503]},
)
def me(user: CurrentUser) -> UserRead:
    """Descreve quem está autenticado, com o papel que a interface usa."""
    return UserRead.model_validate(user)


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Troca a senha do próprio usuário",
    description="Exige a senha atual e aplica a política mínima à nova.",
    responses={
        401: AUTH_RESPONSES[401],
        422: AUTH_RESPONSES[422],
        429: AUTH_RESPONSES[429],
        503: AUTH_RESPONSES[503],
    },
)
def change_password(
    payload: ChangePasswordRequest, user: CurrentUser, service: AuthServiceDep
) -> Response:
    """Troca a senha após conferir a atual."""
    service.change_password(
        user=user,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
