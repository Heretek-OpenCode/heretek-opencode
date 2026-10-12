# @heretek-ai/distro

Pinned OpenCode host distribution wrapper. Upstream OpenCode **v2.0.26**
(`anomalyco/opencode`, branch `v2`) is treated as an external engine:
pinned, wrapped, never forked in-tree.

## Contents

| File | Role |
|---|---|
| `Dockerfile` | Multi-arch Bun image running `opencode serve --port 4096` as unprivileged `opencode` user; liveness probe `GET /api/info` |
| `compat.json` | Machine-readable compat matrix (`sdk`, `host{min,max,tested}`, `gatewayContract`) |
| `scripts/sync.ts` | Upstream sync check: compares vendor version against the pin, verifies the patch queue applies, emits a JSON drift report |
| `patches/` | Patch queue (empty at bootstrap) |

## Usage

```sh
# drift report (non-zero exit with --check when drifted)
bun scripts/sync.ts --upstream=/path/to/opencode
bun scripts/sync.ts --check --upstream=/path/to/opencode

# image (multi-arch)
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/heretek-ai/distro:2.0.26-r1 packages/opencode-distro
docker run -p 4096:4096 ghcr.io/heretek-ai/distro:2.0.26-r1
```

## Notes

- Upstream v2.0.26 exposes **no `/api/health`** (verified against
  `packages/protocol/openapi.json`, 118 paths); the image healthcheck and
  SDK probes use `GET /api/info`.
- `private: true` is staging-only; `publishConfig.access: public` is set for
  the future npm publish.
