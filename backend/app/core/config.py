"""Configuração da aplicação carregada de variáveis de ambiente."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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
