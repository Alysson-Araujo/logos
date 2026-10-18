"""Montagem das mensagens de e-mail do produto.

O texto vive aqui, separado de quem envia e de quem decide enviar: o serviço diz
"convide esta pessoa", e o conteúdo da mensagem é responsabilidade deste módulo.
"""

from __future__ import annotations

from datetime import datetime
from typing import Final

from app.core.mailer import OutboundEmail
from app.domain.accounts import INVITE_TTL_HOURS

#: Assunto do convite — o mesmo aprovado no desenho.
INVITE_SUBJECT: Final[str] = "Sua conta no Logos foi criada"

#: Rótulos de papel em português, para a mensagem não expor o código do enum.
ROLE_LABELS: Final[dict[str, str]] = {
    "REPORTER": "Operador (registra e acompanha os próprios chamados)",
    "ANALYST": "Analista de triagem (conduz a fila de incidentes)",
    "ADMIN": "Administrador (gerencia contas e remove incidentes)",
}


def format_expiry(moment: datetime) -> str:
    """Formata o prazo do convite de forma legível, sem depender de locale."""
    return moment.strftime("%d/%m/%Y às %H:%M UTC")


def build_invite_email(
    *,
    to: str,
    name: str,
    role: str,
    temp_password: str,
    expires_at: datetime,
    frontend_url: str,
) -> OutboundEmail:
    """Monta o e-mail de convite.

    O tom é direto e o passo a passo cabe em uma tela: quem recebe costuma estar
    no meio do turno, muitas vezes lendo no celular.
    """
    papel = ROLE_LABELS.get(role, role)
    corpo = f"""Olá, {name}.

Uma conta no Logos foi criada para você, com o perfil: {papel}.

Para entrar pela primeira vez, use estas credenciais:

    E-mail: {to}
    Senha temporária: {temp_password}

Esta senha vale por {INVITE_TTL_HOURS} horas, até {format_expiry(expires_at)}, e
serve para um único acesso. No primeiro login o Logos vai pedir que você defina
uma senha sua — a temporária deixa de funcionar nesse momento.

Definir minha senha: {frontend_url}

Se você não esperava este convite, ignore esta mensagem: sem usar a senha
temporária, a conta permanece inativa.

--
Logos — Central de Resposta a Incidentes
"""
    return OutboundEmail(to=to, subject=INVITE_SUBJECT, body=corpo)
