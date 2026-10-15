"""Cabeçalhos de segurança e identificação do cliente.

Duas preocupações pequenas que valem para toda resposta e não pertencem a nenhum
endpoint em particular. Ficam juntas porque respondem à mesma pergunta: o que a
API revela sobre quem chamou, e o que ela permite que o navegador faça com a
resposta.

Os cabeçalhos são aplicados no middleware, e não por rota, para valerem também
nas respostas de erro — que é justamente onde um `Content-Type` mal interpretado
faria mais estrago.
"""

from __future__ import annotations

from typing import Final

from fastapi import Request, Response
from starlette.middleware.base import RequestResponseEndpoint

from app.core.config import get_settings

#: Cabeçalho que proxies gerenciados (Render, Vercel, Cloudflare) usam para
#: informar o IP real de quem chamou.
FORWARDED_FOR_HEADER: Final[str] = "X-Forwarded-For"

#: Cabeçalhos aplicados a toda resposta, e o motivo de cada um.
SECURITY_HEADERS: Final[dict[str, str]] = {
    # Impede o navegador de "adivinhar" o tipo do conteúdo e tratar um JSON como
    # script. É a defesa clássica contra MIME sniffing.
    "X-Content-Type-Options": "nosniff",
    # Não vaza a URL da API — que carrega o id do incidente — para sites de
    # terceiros quando alguém clica em um link a partir daqui.
    "Referrer-Policy": "no-referrer",
    # A API não foi feita para ser embutida em iframe de outro site.
    "X-Frame-Options": "DENY",
    # Nada aqui usa câmera, microfone, localização ou pagamento. Declarar isso
    # tira os recursos de qualquer página que consuma a API.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}

#: HSTS só é enviado em produção: em HTTP o navegador ignora, e no
#: desenvolvimento local ele fixaria `https` para `localhost`, atrapalhando.
HSTS_HEADER: Final[str] = "Strict-Transport-Security"
HSTS_VALUE: Final[str] = "max-age=31536000; includeSubDomains"

#: Quando o cliente não é identificável. Não deve acontecer em HTTP normal, mas
#: tratar o caso evita um `None` virando chave de dicionário.
UNKNOWN_CLIENT: Final[str] = "desconhecido"


def client_ip(request: Request) -> str:
    """Devolve o IP do cliente, considerando o proxy à frente da API.

    O `X-Forwarded-For` pode vir como lista (`cliente, proxy1, proxy2`); o
    primeiro item é o cliente original. O valor é falsificável por quem chama a
    API direto, então serve como identificador de limitação de taxa — **não**
    como credencial ou registro de auditoria.
    """
    encaminhado = request.headers.get(FORWARDED_FOR_HEADER)
    if encaminhado:
        primeiro = encaminhado.split(",")[0].strip()
        if primeiro:
            return primeiro
    return request.client.host if request.client is not None else UNKNOWN_CLIENT


async def security_headers_middleware(
    request: Request, call_next: RequestResponseEndpoint
) -> Response:
    """Acrescenta os cabeçalhos de segurança a toda resposta.

    Usa `setdefault` para que um endpoint possa sobrescrever um cabeçalho sem
    que o middleware o atropele.
    """
    response = await call_next(request)
    for nome, valor in SECURITY_HEADERS.items():
        response.headers.setdefault(nome, valor)
    if get_settings().is_production:
        response.headers.setdefault(HSTS_HEADER, HSTS_VALUE)
    return response
