ARG IMAGE_MIRROR=docker.m.daocloud.io

FROM ${IMAGE_MIRROR}/library/node:20-slim AS frontend

ARG NPM_REGISTRY=https://registry.npmmirror.com

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm config set registry "${NPM_REGISTRY}" && npm ci --ignore-scripts
COPY frontend/ ./
RUN npm run build


FROM ${IMAGE_MIRROR}/library/python:3.11-slim AS runtime

ARG APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
ARG APT_SECURITY_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian-security
ARG UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

ENV UV_DEFAULT_INDEX=${UV_INDEX_URL}

RUN sed -i \
      -e "s|http://deb.debian.org/debian|${APT_MIRROR}|g" \
      -e "s|http://deb.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
      -e "s|http://security.debian.org/debian-security|${APT_SECURITY_MIRROR}|g" \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir -i "${PIP_INDEX_URL}" uv

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
