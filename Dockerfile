FROM node:20-slim AS frontend

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build


FROM python:3.11-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
COPY agent/ agent/
COPY oag_ontology/ oag_ontology/
COPY app/ app/

RUN uv sync --frozen --no-dev

COPY domains/ domains/
COPY static/ static/
COPY --from=frontend /build/frontend/dist frontend/dist
COPY entrypoint.sh ./

EXPOSE 8000 8765

CMD ["./entrypoint.sh"]
