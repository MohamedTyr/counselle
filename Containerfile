# Counselle agent service. Written in Phase 0; first built in Phase 5 (api.main exists then).
FROM python:3.12-slim

# libpq: runtime dependency of psycopg (the LangGraph Postgres checkpointer driver).
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_CACHE_DIR=/tmp/uv-cache

WORKDIR /app

COPY . .

RUN uv sync --frozen \
    && adduser --system --group --no-create-home counselle \
    && chown -R counselle /app \
    && chown -R counselle /tmp/uv-cache

USER counselle

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
