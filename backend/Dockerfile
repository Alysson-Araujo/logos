# syntax=docker/dockerfile:1

# ---------- estágio 1: dependências e wheel em um venv isolado ----------
FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml README.md ./
COPY app ./app

RUN pip install --upgrade pip && pip install .

# ---------- estágio 2: imagem final enxuta, sem root ----------
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    DATABASE_URL=sqlite:////app/data/logos.db \
    SEED_ON_STARTUP=true \
    LOG_LEVEL=INFO

RUN groupadd --system logos \
    && useradd --system --gid logos --home /app --shell /usr/sbin/nologin logos \
    && mkdir -p /app/data \
    && chown -R logos:logos /app

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
COPY --chown=logos:logos app ./app
COPY --chown=logos:logos alembic ./alembic
COPY --chown=logos:logos alembic.ini pyproject.toml README.md ./

USER logos

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health/live', timeout=3)"

# As migracoes rodam antes do servidor subir. Com uma unica instancia este e o
# caminho mais simples e seguro; em um deploy com varias replicas isso deve
# virar um passo separado (job de release), para nao haver migracao concorrente.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
