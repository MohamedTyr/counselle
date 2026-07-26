FROM node:22-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_TRANSPORT=http \
    VITE_AUTH_SELF_SIGNUP_ENABLED=false
RUN npx vite build

FROM python:3.12-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_CACHE_DIR=/tmp/uv-cache \
    UV_NO_CACHE=1 \
    COUNSELLE_SERVE_SPA=true \
    COUNSELLE_SPA_DIST_DIR=/app/frontend/dist

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY README.md README.md
COPY api/ api/
COPY app/ app/
COPY adapters/ adapters/
COPY config/ config/
COPY counselle_db/ counselle_db/
COPY domain/ domain/
COPY evals/ evals/
COPY migrations/ migrations/
COPY scripts/ scripts/
COPY skills/ skills/
COPY --from=frontend-build /app/frontend/dist frontend/dist
RUN uv sync --frozen --no-dev

RUN chmod +x scripts/entrypoint.sh \
    && adduser --system --group --no-create-home counselle

USER counselle

EXPOSE 8000

ENTRYPOINT ["scripts/entrypoint.sh"]
