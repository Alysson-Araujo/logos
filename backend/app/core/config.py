"""Configuração da aplicação carregada de variáveis de ambiente."""

from __future__ import annotations

from functools import lru_cache
from typing import Final

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Chave de assinatura usada em desenvolvimento e nos testes. Pública de
#: propósito: em produção a validação abaixo recusa a subida com este valor.
#: O `noqa` silencia a regra de segredo embutido — aqui o segredo embutido é
#: intencional e o que impede o uso indevido é justamente a validação.
DEV_AUTH_SECRET_KEY: Final[str] = "logos-dev-chave-local-nao-use-em-producao"  # noqa: S105


class Settings(BaseSettings):
    """Configurações da API Logos, lidas do ambiente e do arquivo .env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Logos API"
    app_version: str = "0.1.0"
    environment: str = "local"
    debug: bool = False
    docs_enabled: bool = True
    log_level: str = "INFO"
    sql_echo: bool = False
    database_url: str = "sqlite:///./logos.db"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    seed_on_startup: bool = True

    # --- Limitação de taxa -------------------------------------------------
    #: Liga o teto de requisições por cliente. Desligar é útil ao rodar carga local.
    rate_limit_enabled: bool = True
    #: Leituras (GET/HEAD) por minuto, por cliente. A tela de triagem lista muito.
    rate_limit_read_per_minute: int = 60
    #: Escritas por minuto, por cliente. Mutação é deliberada e mais cara.
    rate_limit_write_per_minute: int = 20

    # --- Retentativa em falha transitória de banco -------------------------
    #: Tentativas totais, incluindo a primeira.
    retry_max_attempts: int = 3
    #: Teto do backoff da primeira espera; dobra a cada tentativa (1s, 2s, 4s).
    retry_base_delay_seconds: float = 1.0

    # --- Disjuntor de banco ------------------------------------------------
    #: Liga o disjuntor. Desligar é útil para observar a falha crua em teste.
    circuit_breaker_enabled: bool = True
    #: Falhas transitórias consecutivas que abrem o circuito.
    circuit_breaker_failure_threshold: int = 5
    #: Segundos de espera antes de autorizar a sondagem de recuperação.
    circuit_breaker_cooldown_seconds: float = 30.0

    # --- Cache da listagem -------------------------------------------------
    #: Tempo em que a cópia da listagem é considerada fresca.
    cache_ttl_seconds: float = 30.0

    # --- Limites de tempo no servidor de banco -----------------------------
    #: Teto de duração de uma única consulta, em milissegundos.
    db_statement_timeout_ms: int = 5000
    #: Teto de tempo com uma transação aberta e ociosa, em milissegundos.
    db_idle_transaction_timeout_ms: int = 10000

    # --- Autenticação ------------------------------------------------------
    #: Chave de assinatura dos tokens. O valor padrão serve ao
    #: desenvolvimento; em produção a aplicação se recusa a subir com ele.
    auth_secret_key: str = DEV_AUTH_SECRET_KEY
    #: Tempo de vida do token de acesso, em segundos. Oito horas cobrem um
    #: turno inteiro sem exigir novo login no meio do expediente.
    auth_token_ttl_seconds: int = 8 * 3600

    # --- Convite e envio de e-mail -----------------------------------------
    #: URL pública do frontend, usada no link "Definir minha senha" do convite.
    frontend_url: str = "http://localhost:5173"
    #: Sem host configurado, o envio vai para o LOG em vez de sair pela rede.
    #: É o que permite percorrer o fluxo do convite sem credencial de e-mail.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    #: Vazio de propósito: sem host SMTP, o envio do convite vai para o log.
    smtp_password: str = ""
    smtp_from: str = "Logos <nao-responda@logos.local>"
    #: STARTTLS. Ligado por padrão: desligar só faz sentido em servidor local.
    smtp_use_tls: bool = True

    @model_validator(mode="after")
    def _require_real_secret_in_production(self) -> Settings:
        """Recusa subir em produção com a chave de exemplo.

        Uma chave de assinatura pública é pior que nenhuma: qualquer pessoa
        forja um token válido para qualquer usuário. Falhar na subida é melhor
        que rodar em silêncio com a porta aberta.
        """
        if self.is_production and self.auth_secret_key == DEV_AUTH_SECRET_KEY:
            raise ValueError(
                "AUTH_SECRET_KEY precisa ser definida em produção; "
                "o valor padrão é público e permite forjar tokens."
            )
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        """Devolve as origens de CORS como lista, ignorando entradas vazias."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        """Indica se o ambiente atual é produção."""
        return self.environment.lower() in {"production", "prod"}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Devolve a instância única de configuração (cacheada)."""
    return Settings()


def reset_settings_cache() -> None:
    """Limpa o cache de configuração (usado em testes e no bootstrap)."""
    get_settings.cache_clear()
