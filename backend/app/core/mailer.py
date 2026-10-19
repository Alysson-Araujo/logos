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

## O que estava errado

O `SmtpMailer` fazia `smtplib.SMTP(host, porta)` e ia direto ao `login()`. Isso
funciona por acidente na maioria dos servidores — o `login` do `smtplib` faz o
`ehlo` sozinho — mas quebra em quem exige o cumprimento explícito, e o erro sai
como `SMTPHeloError`, que ninguém associa a "faltou EHLO". Também não tratava a
porta 465, que abre em TLS direto e não aceita `starttls()`.

O problema mais grave, porém, não era nenhum desses. O `UserService` engolia
qualquer exceção do envio e só registrava um `logger.exception`. Resultado: o
SMTP recusava a credencial, a API respondia `201`, a tela dizia "Convite
enviado" e **o e-mail não chegava**. Nenhum usuário, nenhuma tela e nenhum
health check sabia disso — só uma linha de log que ninguém lê.

A correção tem duas partes: esta aqui (o envio em si, que agora levanta
`MailDeliveryError`) e a de cima (o `UserService` transforma a falha em
`INVITE_DELIVERY_FAILED`, que aparece na resposta).
"""

from __future__ import annotations

import logging
import smtplib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.message import EmailMessage
from email.utils import formataddr, formatdate, getaddresses, make_msgid
from typing import Final, Protocol

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

#: Tempo máximo de uma conversa SMTP. Sem ele, um servidor de e-mail fora do ar
#: deixaria a requisição de convite pendurada — e o cadastro não pode depender
#: de um serviço que não é o dele.
SMTP_TIMEOUT_SECONDS: Final[float] = 10.0


@dataclass(frozen=True, slots=True)
class OutboundEmail:
    """Mensagem pronta para envio.

    `html` é opcional: quando existe, vai como `text/html` e o `body` vira a
    alternativa em texto puro. Isso não é detalhe cosmético — um e-mail só de
    HTML tem taxa de entrega pior e nem todo cliente renderiza marcação. As
    duas versões dizem a mesma coisa, sempre.
    """

    to: str
    subject: str
    body: str
    html: str | None = None
    #: Cabeçalhos extras, como `Reply-To`.
    headers: dict[str, str] = field(default_factory=dict)


class MailDeliveryError(Exception):
    """O envio falhou e quem chamou precisa saber.

    Existe para separar "e-mail não entregue" de "defeito inesperado": o serviço
    traduz esta exceção num erro de negócio claro, e deixa as demais subirem como
    500. Engolir as duas no mesmo `except Exception` foi o que criou o silêncio.
    """


class Mailer(Protocol):
    """Porta de envio de e-mail.

    Um protocolo, e não uma classe base: quem implementa só precisa ter o
    método `send`, sem herdar de nada.
    """

    def send(self, message: OutboundEmail) -> None:
        """Entrega a mensagem, ou levanta `MailDeliveryError`.

        A porta não decide o que a falha significa para o produto — só que ela
        ocorreu.
        """
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


def parse_sender(raw: str) -> tuple[str, str]:
    """Separa `Nome <endereco>` em nome e endereço.

    Uma configuração malformada vira erro de construção da mensagem, e não um
    `From` inválido que o servidor aceita e o destinatário marca como spam.
    """
    pares = getaddresses([raw])
    if not pares or not pares[0][1] or "@" not in pares[0][1]:
        raise MailDeliveryError("SMTP_FROM inválido: use o formato 'Nome <email@dominio>'.")
    return pares[0]


class SmtpMailer:
    """Entrega por SMTP, usando a configuração do ambiente."""

    def __init__(self, settings: Settings) -> None:
        """Guarda a configuração usada na conexão."""
        self._settings = settings

    def _connect(self) -> smtplib.SMTP:
        """Abre a conexão com o servidor, já com TLS e autenticação.

        Porta 465 abre em TLS direto (`SMTP_SSL`); qualquer outra usa a conexão
        em claro e sobe para TLS com `starttls()`. Tratar as duas formas importa
        porque o Gmail oferece ambas e um host pode ter só a 465 liberada — exigir
        `starttls` ali transformaria uma configuração válida em "não envia".
        """
        settings = self._settings
        if settings.smtp_port == 465:
            servidor: smtplib.SMTP = smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=SMTP_TIMEOUT_SECONDS,
            )
        else:
            servidor = smtplib.SMTP(
                settings.smtp_host,
                settings.smtp_port,
                timeout=SMTP_TIMEOUT_SECONDS,
            )
            if settings.smtp_use_tls:
                # `ehlo()` explícito antes do STARTTLS: sem ele, o `starttls`
                # depende de o servidor aceitar a extensão sem ela ter sido
                # negociada, e o erro sai como `SMTPNotSupportedError` sem dizer
                # o motivo real.
                servidor.ehlo()
                servidor.starttls()
        # Um `ehlo` depois do TLS: o servidor anuncia um conjunto diferente de
        # extensões em conexão cifrada, e é essa lista que vale para o login.
        servidor.ehlo()
        if settings.smtp_user:
            servidor.login(settings.smtp_user, settings.smtp_password)
        return servidor

    def _build(self, message: OutboundEmail) -> EmailMessage:
        """Monta a mensagem com os cabeçalhos que entregadores esperam."""
        email = EmailMessage()
        nome, endereco = parse_sender(self._settings.smtp_from)
        email["From"] = formataddr((nome, endereco))
        email["To"] = message.to
        email["Subject"] = message.subject
        email["Date"] = formatdate(localtime=False)
        # Sem `Message-ID` próprio, alguns servidores — o Gmail entre eles —
        # geram um em nome do servidor de saída. Um id único e estável também é
        # o que permite rastrear a mensagem nos logs do provedor.
        email["Message-ID"] = make_msgid(domain=endereco.split("@", 1)[1])
        for chave, valor in message.headers.items():
            email[chave] = valor

        if message.html:
            email.set_content(message.body)
            email.add_alternative(message.html, subtype="html")
        else:
            email.set_content(message.body)
        return email

    def send(self, message: OutboundEmail) -> None:
        """Monta a mensagem e envia pelo servidor configurado.

        Toda falha de SMTP vira `MailDeliveryError` com o destinatário e o tipo
        do erro. A mensagem original do servidor entra no log, **não** na
        exceção: ela pode conter o endereço remoto e detalhes de conta, e a
        exceção acaba na resposta HTTP.
        """
        try:
            email = self._build(message)
        except MailDeliveryError:
            raise
        except Exception as exc:
            raise MailDeliveryError(
                f"Não foi possível montar a mensagem para {message.to}: {type(exc).__name__}."
            ) from exc

        try:
            with self._connect() as servidor:
                servidor.send_message(email)
        except smtplib.SMTPAuthenticationError as exc:
            logger.error(
                "smtp_autenticacao_recusada destinatario=%s codigo=%s",
                message.to,
                exc.smtp_code,
            )
            raise MailDeliveryError(
                "O servidor de e-mail recusou a credencial configurada. "
                "Verifique SMTP_USER e SMTP_PASSWORD."
            ) from exc
        except (smtplib.SMTPException, OSError) as exc:
            logger.error(
                "smtp_falha destinatario=%s erro=%s detalhe=%s",
                message.to,
                type(exc).__name__,
                exc,
            )
            raise MailDeliveryError(
                f"Não foi possível entregar o e-mail para {message.to}: {type(exc).__name__}."
            ) from exc

        logger.info(
            "email_enviado destinatario=%s assunto=%s em=%s",
            message.to,
            message.subject,
            datetime.now(UTC).isoformat(),
        )


def get_mailer() -> Mailer:
    """Devolve o mailer conforme a configuração.

    Sem `SMTP_HOST`, devolve o de log — que é o que mantém o fluxo de convite
    demonstrável em qualquer máquina, sem credencial nenhuma.
    """
    settings = get_settings()
    if settings.smtp_host:
        return SmtpMailer(settings)
    return LoggingMailer()
