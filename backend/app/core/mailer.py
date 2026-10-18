"""Porta de envio de e-mail e suas duas implementações.

O projeto **não tinha** infraestrutura de e-mail, e o convite precisa de uma.
A saída foi separar a **porta** (`Mailer`) da **implementação**:

- `LoggingMailer` escreve a mensagem no log. É o padrão em desenvolvimento e
  teste, e é o que permite percorrer o fluxo completo do convite — criar conta,
  ler a senha temporária, entrar, trocar a senha — sem depender de credencial de
  e-mail nem de caixa de entrada.
- `SmtpMailer` fala SMTP de verdade, e passa a ser usado assim que `SMTP_HOST`
  estiver configurado.

**Trocar de um para o outro é configuração, não reescrita.**
"""

from __future__ import annotations

import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Final, Protocol

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

#: Tempo máximo de uma conversa SMTP. Sem ele, um servidor de e-mail fora do ar
#: deixaria a requisição de convite pendurada — e o cadastro não pode depender
#: de um serviço que não é o dele.
SMTP_TIMEOUT_SECONDS: Final[float] = 10.0


@dataclass(frozen=True, slots=True)
class OutboundEmail:
    """Mensagem pronta para envio."""

    to: str
    subject: str
    body: str


class Mailer(Protocol):
    """Porta de envio de e-mail.

    Um protocolo, e não uma classe base: quem implementa só precisa ter o
    método `send`, sem herdar de nada.
    """

    def send(self, message: OutboundEmail) -> None:
        """Entrega a mensagem."""
        ...


class LoggingMailer:
    """Escreve a mensagem no log, em vez de enviá-la.

    Padrão em desenvolvimento e teste. O corpo vai inteiro de propósito: é o que
    permite completar o primeiro acesso sem servidor de e-mail.
    """

    def send(self, message: OutboundEmail) -> None:
        """Registra destinatário, assunto e corpo."""
        logger.info(
            "email_para_log destinatario=%s assunto=%s\n%s",
            message.to,
            message.subject,
            message.body,
        )


class SmtpMailer:
    """Entrega por SMTP, usando a configuração do ambiente."""

    def __init__(self, settings: Settings) -> None:
        """Guarda a configuração usada na conexão."""
        self._settings = settings

    def send(self, message: OutboundEmail) -> None:
        """Monta a mensagem e envia pelo servidor configurado."""
        email = EmailMessage()
        email["From"] = self._settings.smtp_from
        email["To"] = message.to
        email["Subject"] = message.subject
        email.set_content(message.body)

        with smtplib.SMTP(
            self._settings.smtp_host,
            self._settings.smtp_port,
            timeout=SMTP_TIMEOUT_SECONDS,
        ) as servidor:
            if self._settings.smtp_use_tls:
                servidor.starttls()
            if self._settings.smtp_user:
                servidor.login(self._settings.smtp_user, self._settings.smtp_password)
            servidor.send_message(email)


def get_mailer() -> Mailer:
    """Devolve o mailer conforme a configuração.

    Sem `SMTP_HOST`, devolve o de log — que é o que mantém o fluxo de convite
    demonstrável em qualquer máquina, sem credencial nenhuma.
    """
    settings = get_settings()
    if settings.smtp_host:
        return SmtpMailer(settings)
    return LoggingMailer()
