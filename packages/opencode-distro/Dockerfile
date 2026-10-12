# syntax=docker/dockerfile:1
# Heretek-OpenCode host distribution image (upstream OpenCode v2.0.26, pinned).
# Multi-arch: build with `docker buildx build --platform linux/amd64,linux/arm64`.
#
# Verified live: packages/opencode-sdk/test/host-live.test.ts passes real HTTP
# against both v2.0.26 (this pin) and v2.0.27 (see compat.json).
#
# NOTE: upstream v2 exposes no /api/health (verified against
# packages/protocol/openapi.json: 118 paths, /api/info GET); the liveness
# probe is GET /api/info with Basic auth from $OPENCODE_PASSWORD.
ARG BUN_VERSION=1.4.2
ARG HOST_VERSION=2.0.26

FROM ubuntu:24.04 AS base
ARG BUN_VERSION
ARG HOST_VERSION
ENV DEBIAN_FRONTEND=noninteractive \
    OPENCODE_PORT=4096 \
    BUN_INSTALL=/usr/local \
    PATH=/usr/local/bin:$PATH
LABEL org.heretek-ai.distro="opencode-distro" \
      org.heretek-ai.host-version="${HOST_VERSION}"

# Toolchain required by the host runtime and the install scripts below.
# tar: required by the opencode v2 install script on linux.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       git \
       jq \
       ripgrep \
       tar \
       tini \
       unzip \
  && rm -rf /var/lib/apt/lists/*

# Bun (pinned) via the official install script, system-wide.
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
  && bun --version | grep -q "${BUN_VERSION}" \
  && bun --version

# OpenCode v2 (pinned) via the official v2 install script, then promoted to
# /usr/local/bin so the unprivileged runtime user can execute it.
RUN curl -fsSL https://opencode.ai/v2/install | bash -s -- --version "${HOST_VERSION}" \
  && install -m755 /root/.opencode/bin/opencode /usr/local/bin/opencode \
  && rm -rf /root/.opencode \
  && opencode --version | grep -q "${HOST_VERSION}" \
  && opencode --version

# Unprivileged runtime user `agent` (UID 1000). The ubuntu:24.04 base ships a
# UID-1000 `ubuntu` user, so rename it in place when present instead of
# colliding with useradd.
RUN set -e; \
  if getent passwd 1000 >/dev/null; then \
    oldu=$(getent passwd 1000 | cut -d: -f1); \
    if [ "$oldu" != "agent" ]; then \
      oldg=$(id -gn "$oldu"); \
      usermod -l agent -d /home/agent -m "$oldu"; \
      if [ "$oldg" = "$oldu" ]; then groupmod -n agent "$oldg"; else groupadd agent; usermod -g agent agent; fi; \
    fi; \
  else \
    useradd -m -u 1000 agent; \
  fi; \
  mkdir -p /home/agent/.local/share/opencode /workspace; \
  chown -R agent:agent /home/agent /workspace; \
  id agent
USER agent
WORKDIR /workspace
EXPOSE 4096
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS -u "opencode:${OPENCODE_PASSWORD:-}" "http://127.0.0.1:4096/api/info" > /dev/null
ENTRYPOINT ["tini", "--", "opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
