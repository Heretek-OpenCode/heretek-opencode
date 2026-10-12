# syntax=docker/dockerfile:1
# Heretek-OpenCode host distribution image (upstream OpenCode v2.0.26, pinned).
# Multi-arch: build with `docker buildx build --platform linux/amd64,linux/arm64`.
ARG BUN_VERSION=1.4.2
ARG HOST_VERSION=2.0.26

FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION} AS install
ARG HOST_VERSION
WORKDIR /app
# Install the pinned host CLI only; no source fork in this layer.
RUN bun add -g opencode-ai@${HOST_VERSION}

FROM oven/bun:${BUN_VERSION}-slim
ARG HOST_VERSION
LABEL org.heretek-ai.distro="opencode-distro" \
      org.heretek-ai.host-version="${HOST_VERSION}"
ENV OPENCODE_PORT=4096
RUN adduser --disabled-password --gecos "" opencode \
  && mkdir -p /home/opencode/.local/share/opencode /workspace \
  && chown -R opencode:opencode /home/opencode /workspace
COPY --from=install /usr/local/bin/opencode /usr/local/bin/opencode
USER opencode
WORKDIR /workspace
EXPOSE 4096
# NOTE: upstream v2.0.26 exposes no /api/health; /api/info is the
# verified liveness probe (see openapi.json: 118 paths, /api/info GET).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:4096/api/info');if(!r.ok)process.exit(1)"
CMD ["opencode", "serve", "--port", "4096"]
