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
