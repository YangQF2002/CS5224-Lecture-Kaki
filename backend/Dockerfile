# syntax=docker/dockerfile:1

FROM python:3.14.8-slim-trixie@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app

FROM base AS dependencies

# Keep Poetry and its dependencies outside the application virtual environment.
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m venv /opt/poetry \
    && /opt/poetry/bin/pip install poetry==2.4.1 \
    && python -m venv /opt/venv

COPY pyproject.toml poetry.lock ./
RUN --mount=type=cache,target=/root/.cache/pypoetry \
    /opt/poetry/bin/poetry check --lock \
    && /opt/poetry/bin/poetry install --only main --no-root --no-interaction --no-ansi

FROM dependencies AS test

RUN --mount=type=cache,target=/root/.cache/pypoetry \
    /opt/poetry/bin/poetry install --with dev --no-root --no-interaction --no-ansi
COPY app ./app
COPY lambdas ./lambdas
COPY jobs ./jobs
COPY scripts ./scripts
COPY tests ./tests
# Windows build contexts can mark copied Python files executable.
RUN find . -type f -name '*.py' -exec chmod 644 {} +
USER 10001:10001
CMD ["sh", "-c", "ruff check --no-cache . && ruff format --check --no-cache . && python -m pytest -p no:cacheprovider"]

FROM base AS runtime

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --no-log-init app
COPY --from=dependencies /opt/venv /opt/venv
COPY app ./app
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
