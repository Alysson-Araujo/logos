"""Cabeçalhos de segurança, CORS e recusa por excesso de requisições."""

from __future__ import annotations

from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient

from app.core.config import reset_settings_cache
from app.core.rate_limit import reset_rate_limiters
from app.core.security import SECURITY_HEADERS

INCIDENTS_URL = "/api/v1/incidents"
INEXISTENTE = f"{INCIDENTS_URL}/2f1c9f7e-0000-4000-8000-000000000000"
HEALTH_URL = "/api/v1/health/live"


@pytest.fixture()
def rate_limit_ligado(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[Callable[..., None]]:
    """Liga o teto com valores baixos, e devolve o estado anterior ao final.

    A configuração é lida a cada requisição, então basta limpar os caches depois
    de mexer nas variáveis de ambiente.
    """

    def ligar(*, leitura: int = 3, escrita: int = 2) -> None:
        monkeypatch.setenv("RATE_LIMIT_ENABLED", "true")
        monkeypatch.setenv("RATE_LIMIT_READ_PER_MINUTE", str(leitura))
        monkeypatch.setenv("RATE_LIMIT_WRITE_PER_MINUTE", str(escrita))
        reset_settings_cache()
        reset_rate_limiters()

    yield ligar
    reset_settings_cache()
    reset_rate_limiters()


# --------------------------------------------------------------------------- #
# Cabeçalhos de segurança
# --------------------------------------------------------------------------- #
def test_cabecalhos_de_seguranca_na_resposta_de_sucesso(client: TestClient) -> None:
    resposta = client.get(INCIDENTS_URL)
    assert resposta.status_code == 200
    for nome, valor in SECURITY_HEADERS.items():
        assert resposta.headers.get(nome) == valor


def test_cabecalhos_de_seguranca_tambem_na_resposta_de_erro(client: TestClient) -> None:
    """É no erro que um Content-Type mal interpretado faria mais estrago."""
    resposta = client.get(INEXISTENTE)
    assert resposta.status_code == 404
    for nome, valor in SECURITY_HEADERS.items():
        assert resposta.headers.get(nome) == valor


def test_hsts_nao_e_enviado_fora_de_producao(client: TestClient) -> None:
    """Em HTTP o navegador ignora HSTS, e em local ele fixaria https em localhost."""
    assert "strict-transport-security" not in client.get(INCIDENTS_URL).headers


def test_cabecalhos_de_seguranca_tambem_na_recusa_por_cota(
    client: TestClient, rate_limit_ligado: Callable[..., None]
) -> None:
    rate_limit_ligado(leitura=1)
    assert client.get(INCIDENTS_URL).status_code == 200
    recusada = client.get(INCIDENTS_URL)
    assert recusada.status_code == 429
    for nome, valor in SECURITY_HEADERS.items():
        assert recusada.headers.get(nome) == valor


# --------------------------------------------------------------------------- #
# CORS
# --------------------------------------------------------------------------- #
def test_cors_libera_a_origem_configurada(client: TestClient) -> None:
    resposta = client.get(INCIDENTS_URL, headers={"Origin": "http://localhost:5173"})
    assert resposta.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_cors_nao_libera_origem_desconhecida(client: TestClient) -> None:
    resposta = client.get(INCIDENTS_URL, headers={"Origin": "http://malicioso.example"})
    assert "access-control-allow-origin" not in resposta.headers


# --------------------------------------------------------------------------- #
# Limitação de taxa
# --------------------------------------------------------------------------- #
def test_excesso_de_leitura_recusa_com_429_e_retry_after(
    client: TestClient, rate_limit_ligado: Callable[..., None]
) -> None:
    rate_limit_ligado(leitura=3)
    for _ in range(3):
        assert client.get(INCIDENTS_URL).status_code == 200

    recusada = client.get(INCIDENTS_URL)

    assert recusada.status_code == 429
    assert recusada.headers["Retry-After"].isdigit()
    assert int(recusada.headers["Retry-After"]) >= 1

    erro = recusada.json()["error"]
    assert erro["code"] == "RATE_LIMIT_EXCEEDED"
    assert erro["details"]["limitPerMinute"] == 3
    assert erro["details"]["retryAfterSeconds"] > 0
    # O 429 passa pelo middleware de contexto, então tem correlação de log.
    assert erro["requestId"]
    assert recusada.headers.get("X-Request-Id") == erro["requestId"]


def test_leitura_e_escrita_tem_cotas_independentes(
    client: TestClient, rate_limit_ligado: Callable[..., None]
) -> None:
    """A tela lista o tempo todo; a mutação é deliberada. Um teto único não serve."""
    rate_limit_ligado(leitura=1, escrita=1)

    assert client.get(INCIDENTS_URL).status_code == 200
    assert client.get(INCIDENTS_URL).status_code == 429

    # A cota de escrita continua intacta, mesmo com a de leitura esgotada.
    assert client.delete(INEXISTENTE).status_code == 404


def test_escrita_que_falha_tambem_consome_a_cota(
    client: TestClient, rate_limit_ligado: Callable[..., None]
) -> None:
    """O trabalho foi feito; contar só o sucesso deixaria a porta aberta."""
    rate_limit_ligado(escrita=2)

    assert client.delete(INEXISTENTE).status_code == 404
    assert client.delete(INEXISTENTE).status_code == 404
    assert client.delete(INEXISTENTE).status_code == 429


def test_health_nao_consome_cota(
    client: TestClient, rate_limit_ligado: Callable[..., None]
) -> None:
    """Recusar o healthcheck faz a plataforma marcar o serviço como doente."""
    rate_limit_ligado(leitura=1)

    for _ in range(5):
        assert client.get(HEALTH_URL).status_code == 200

    # E a cota da API continua intacta.
    assert client.get(INCIDENTS_URL).status_code == 200


def test_preflight_de_cors_nao_consome_cota(
    client: TestClient, rate_limit_ligado: Callable[..., None]
) -> None:
    """Preflight não é trabalho da API."""
    rate_limit_ligado(leitura=1)

    preflight = client.options(
        INCIDENTS_URL,
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert preflight.status_code == 200
    assert client.get(INCIDENTS_URL).status_code == 200


def test_cliente_identificado_por_x_forwarded_for(
    client: TestClient, rate_limit_ligado: Callable[..., None]
) -> None:
    """Atrás do proxy do Render todo mundo chegaria com o mesmo IP interno."""
    rate_limit_ligado(leitura=1)

    assert client.get(INCIDENTS_URL, headers={"X-Forwarded-For": "203.0.113.10"}).status_code == 200
    # Outro cliente, com outra cota.
    assert client.get(INCIDENTS_URL, headers={"X-Forwarded-For": "203.0.113.11"}).status_code == 200
    # E o primeiro já gastou a dele.
    assert client.get(INCIDENTS_URL, headers={"X-Forwarded-For": "203.0.113.10"}).status_code == 429
