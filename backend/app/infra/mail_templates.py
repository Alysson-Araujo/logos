"""Montagem das mensagens de e-mail do produto.

O texto vive aqui, separado de quem envia e de quem decide enviar: o serviço diz
"convide esta pessoa", e o conteúdo da mensagem é responsabilidade deste módulo.

## A referência é o Figma

A seção **"Convite · e-mail"** do arquivo de prototipação define a mensagem
campo a campo, e este módulo a reproduz. Os valores abaixo foram lidos do nó
`22:4723` (`Frame "Convite · mensagem de e-mail"`), não estimados:

| Elemento | Especificação |
|---|---|
| Remetente | `Logos · Central de Resposta a Incidentes` |
| Assunto | `Sua conta no Logos foi criada` |
| Saudação | `Olá, Joana.` — primeiro nome |
| Papel | `com o papel REPORTER` — o código do enum, em maiúsculas |
| Caixa da senha | fundo `#ECEFF3`, borda `#D5DAE2`, raio 8, rótulo `SUA SENHA TEMPORÁRIA` |
| Senha | JetBrains Mono SemiBold, ao lado de `selecione e copie` |
| Prazo | `A senha expira em 24 horas e vale apenas para o primeiro acesso.` |
| Ação | botão `Definir minha senha`, fundo `#1D4ED8`, raio 6 |
| Rodapé | `Se você não esperava este convite, ignore esta mensagem...` em `#55606F` |

O corpo em texto puro carrega as mesmas informações na mesma ordem. Os dois
são gerados da mesma fonte de dados, então não podem divergir.
"""

from __future__ import annotations

from datetime import datetime
from html import escape
from typing import Final

from app.core.mailer import OutboundEmail
from app.domain.accounts import INVITE_TTL_HOURS

#: Assunto do convite — o mesmo aprovado no desenho.
INVITE_SUBJECT: Final[str] = "Sua conta no Logos foi criada"

#: Nome apresentado no remetente, ao lado do endereço no cabeçalho `From`.
SENDER_NAME: Final[str] = "Logos · Central de Resposta a Incidentes"

#: Rótulo do papel como o frame mostra: o código do enum, em maiúsculas.
#:
#: O Figma escreve `com o papel REPORTER`, e não a descrição em português. É
#: proposital: quem recebe o convite encontra esse mesmo código na tela de
#: contas, e dois textos para o mesmo papel confundiriam.
ROLE_LABELS: Final[dict[str, str]] = {
    "REPORTER": "REPORTER",
    "ANALYST": "ANALYST",
    "ADMIN": "ADMIN",
}

#: Descrição curta, usada só na versão HTML — onde o espaço não é apertado e o
#: valor de negócio é a pessoa entender o que poderá fazer.
ROLE_DESCRIPTIONS: Final[dict[str, str]] = {
    "REPORTER": "registra e acompanha os próprios chamados",
    "ANALYST": "conduz a fila de incidentes",
    "ADMIN": "gerencia contas e remove incidentes",
}

# --- Paleta do frame --------------------------------------------------------
# Os mesmos valores do Figma. Ficam nomeados para que um ajuste no desenho seja
# uma linha, e não uma busca por códigos soltos no meio do HTML.
COLOR_BACKGROUND: Final[str] = "#F5F6F8"
COLOR_CARD: Final[str] = "#FFFFFF"
COLOR_HEADER: Final[str] = "#ECEFF3"
COLOR_BORDER: Final[str] = "#D5DAE2"
COLOR_TEXT: Final[str] = "#16181D"
COLOR_MUTED: Final[str] = "#55606F"
COLOR_ACTION: Final[str] = "#1D4ED8"


def format_expiry(moment: datetime) -> str:
    """Formata o prazo do convite de forma legível, sem depender de locale."""
    return moment.strftime("%d/%m/%Y às %H:%M UTC")


def first_name(name: str) -> str:
    """Primeiro nome, para a saudação do frame ("Olá, Joana.")."""
    partes = name.strip().split()
    return partes[0] if partes else name.strip()


def change_password_url(frontend_url: str) -> str:
    """Endereço do primeiro acesso.

    Aponta para a raiz do frontend com `?primeiro-acesso=1`, e não para uma rota
    de troca de senha: a pessoa chega na tela de login já sabendo por que está
    ali. A senha **não** vai na URL — links com credencial acabam em histórico
    de navegador, log de proxy e relatório de clique.
    """
    return f"{frontend_url.rstrip('/')}?primeiro-acesso=1"


def _text_body(
    *,
    to: str,
    name: str,
    role: str,
    temp_password: str,
    expires_at: datetime,
    url: str,
) -> str:
    """Versão em texto puro, na mesma ordem do frame."""
    papel = ROLE_LABELS.get(role, role)
    return f"""Olá, {first_name(name)}.

Uma conta foi criada para você na Central de Resposta a Incidentes da AutoU, \
com o papel {papel}. Use a senha temporária abaixo para entrar pela primeira vez.

    SUA SENHA TEMPORÁRIA

    {temp_password}
    (selecione e copie)

A senha expira em {INVITE_TTL_HOURS} horas e vale apenas para o primeiro acesso.

Definir minha senha: {url}

Se você não esperava este convite, ignore esta mensagem: nada é ativado antes \
de alguém definir a senha.

--
Logos · Central de Resposta a Incidentes
Convite enviado para {to} e válido até {format_expiry(expires_at)}.
"""


def _html_body(
    *,
    to: str,
    name: str,
    role: str,
    temp_password: str,
    url: str,
) -> str:
    """Versão em HTML, reproduzindo o frame.

    Tabela e estilos embutidos, não `div` com classe: clientes de e-mail
    (Outlook, principalmente) descartam folha de estilo externa e têm suporte
    irregular a flexbox. A largura máxima é 560px, que é o que cabe numa janela
    de leitura sem quebrar linha.
    """
    papel = ROLE_LABELS.get(role, role)
    descricao = ROLE_DESCRIPTIONS.get(role, "")
    detalhe_papel = f" — {escape(descricao)}" if descricao else ""
    # `escape` em tudo que vem de dado: o nome é digitado por um administrador,
    # e um `<` nele viraria marcação arbitrária no e-mail de outra pessoa.
    saudacao = escape(first_name(name))
    email_seguro = escape(to)
    senha_segura = escape(temp_password)
    url_segura = escape(url, quote=True)

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(INVITE_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background:{COLOR_BACKGROUND};">
<!-- Pré-header: o trecho que o cliente de e-mail mostra ao lado do assunto. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
Sua conta no Logos foi criada. A senha temporária expira em {INVITE_TTL_HOURS} horas.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:{COLOR_BACKGROUND};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;background:{COLOR_CARD};border:1px solid {COLOR_BORDER};
                    border-radius:12px;overflow:hidden;
                    font-family:Inter,'Segoe UI',Arial,sans-serif;">

        <!-- Cabecalho -->
        <tr>
          <td style="background:{COLOR_HEADER};padding:20px 28px 18px 28px;">
            <p style="margin:0 0 6px 0;font-size:12px;line-height:16px;color:{COLOR_TEXT};">
              <strong style="font-weight:600;">{escape(SENDER_NAME)}</strong>
            </p>
            <p style="margin:0;font-size:12px;line-height:16px;color:{COLOR_MUTED};">
              Para: {email_seguro}
            </p>
            <p style="margin:8px 0 0 0;font-size:14px;line-height:20px;
                      font-weight:600;color:{COLOR_TEXT};">{escape(INVITE_SUBJECT)}</p>
          </td>
        </tr>
        <tr><td style="height:1px;background:{COLOR_BORDER};line-height:1px;">&nbsp;</td></tr>

        <!-- Corpo -->
        <tr>
          <td style="padding:22px 28px 22px 28px;">
            <p style="margin:0 0 14px 0;font-size:14px;line-height:20px;color:{COLOR_TEXT};">
              Olá, {saudacao}.
            </p>
            <p style="margin:0 0 14px 0;font-size:14px;line-height:20px;color:{COLOR_TEXT};">
              Uma conta foi criada para você na Central de Resposta a Incidentes da
              AutoU, com o papel <strong>{escape(papel)}</strong>{detalhe_papel}.
              Use a senha temporária abaixo para entrar pela primeira vez.
            </p>

            <!-- Caixa da senha temporaria -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="background:{COLOR_HEADER};border:1px solid {COLOR_BORDER};
                          border-radius:8px;">
              <tr>
                <td style="padding:14px 16px 14px 16px;">
                  <p style="margin:0 0 6px 0;font-size:12px;line-height:16px;
                            font-weight:600;letter-spacing:0.3px;color:{COLOR_MUTED};">
                    SUA SENHA TEMPORÁRIA
                  </p>
                  <p style="margin:0;font-family:'JetBrains Mono',Consolas,monospace;
                            font-size:16px;line-height:20px;font-weight:600;
                            letter-spacing:0.5px;color:{COLOR_TEXT};">
                    {senha_segura}
                  </p>
                  <p style="margin:4px 0 0 0;font-size:12px;line-height:16px;
                            color:{COLOR_MUTED};">selecione e copie</p>
                </td>
              </tr>
            </table>

            <p style="margin:14px 0 0 0;font-size:13px;line-height:18px;color:{COLOR_TEXT};">
              A senha expira em {INVITE_TTL_HOURS} horas e vale apenas para o primeiro acesso.
            </p>

            <!-- Acao -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin:14px 0 0 0;">
              <tr>
                <td style="background:{COLOR_ACTION};border-radius:6px;">
                  <a href="{url_segura}"
                     style="display:inline-block;padding:9px 16px;font-size:14px;
                            line-height:18px;font-weight:500;color:#FFFFFF;
                            text-decoration:none;">Definir minha senha</a>
                </td>
              </tr>
            </table>

            <p style="margin:14px 0 0 0;font-size:12px;line-height:16px;color:{COLOR_MUTED};">
              Se você não esperava este convite, ignore esta mensagem: nada é ativado
              antes de alguém definir a senha.
            </p>
          </td>
        </tr>
      </table>

      <p style="margin:12px 0 0 0;font-size:11px;line-height:16px;color:{COLOR_MUTED};
                font-family:Inter,'Segoe UI',Arial,sans-serif;">
        Se o botão não abrir, copie o endereço:<br>
        <a href="{url_segura}" style="color:{COLOR_ACTION};word-break:break-all;">{url_segura}</a>
      </p>
    </td>
  </tr>
</table>
</body>
</html>
"""


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
    url = change_password_url(frontend_url)
    corpo = _text_body(
        to=to,
        name=name,
        role=role,
        temp_password=temp_password,
        expires_at=expires_at,
        url=url,
    )
    html = _html_body(to=to, name=name, role=role, temp_password=temp_password, url=url)

    return OutboundEmail(
        to=to,
        subject=INVITE_SUBJECT,
        body=corpo,
        html=html,
        # Respostas a um convite não têm para onde ir: o endereço de envio é
        # `nao-responda`. Deixar o `Reply-To` implícito mandaria a resposta para
        # lá e sumiria numa caixa que ninguém abre.
        headers={"Reply-To": f"{SENDER_NAME} <{reply_to_address(frontend_url)}>"},
    )


def reply_to_address(frontend_url: str) -> str:
    """Endereço de resposta, derivado do host do frontend configurado.

    O módulo não adivinha um domínio de e-mail: usa `nao-responda@` no domínio
    do próprio frontend, que é o único que a aplicação conhece.
    """
    host = frontend_url.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0]
    if not host or host in {"localhost", "127.0.0.1"}:
        host = "logoscase.com.br"
    return f"nao-responda@{host}"
