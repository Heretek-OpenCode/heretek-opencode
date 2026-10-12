# @heretek-ai/opencode-gateway

Hardened web-ingestion MCP gateway (contract v1, `X-Swarm-Contract: 1`),
evolved from scraper-swarm's operational architecture: golden contract
fixtures, fail-closed SSRF, Smokescreen egress proxying.

```
packages/opencode-gateway/
├── contract/            # versioned golden fixtures (contract v1)
├── packages/
│   ├── contract-client/ # @heretek-ai/gateway-contract 1.0.0 (Zod + typed MCP client)
│   └── opencode-guard/  # @heretek-ai/gateway-guard (OpenCode v2 plugin, @opencode/plugin 2.0.26 exact)
├── apps/
│   └── gateway/         # TS/Bun MCP gateway (POST /mcp, GET /ready, GET /health)
├── catalog/             # engine defs (searxng, crawl4ai, scrapling, firecrawl)
└── deploy/              # smokescreen + caddy snippets
```

## Contract

- `POST /mcp` — strict JSON-RPC 2.0 (`-32700`/`-32600`/`-32601`/`-32602`,
  `202` notifications, `initialize` negotiation).
- Every response carries `X-Swarm-Contract: 1`; tools return text plus
  `structuredContent` with the prompt-injection envelope
  (`{ provenance: { url, fetchedAt, engine, contentHash }, trust: "untrusted", content }`)
  and machine-readable error codes.
- Golden fixtures: `contract/v1/fixtures/` (vendor by commit; `contentHash`
  values are real digests — recompute on vendoring).

## Hardening

- **SSRF fail-closed**: literal blocklist (`127/8`, `10/8`, `172.16/12`,
  `192.168/16`, `169.254/16`, `100.64/10`, `::1`, `fc00::/7`, `fe80::/10`,
  `0.0.0.0`, dword/hex/octal/shortened encodings, `::ffff:`-mapped), DNS pin
  (any private resolution denied, NXDOMAIN fails closed), no-redirect-to-private
  (redirects followed manually, every hop checked).
- **Per-host circuit breakers** keyed by `(host, engine)` with half-open
  probes; backoff surfaced in `structuredContent`.
- **Prompt-injection envelope**: zero-width strip (`U+200B–U+200F`, `U+FEFF`,
  `U+2060–U+2064`, `U+180E`), override phrasings → `[removed]`, hash covers
  the sanitized bytes.
- **Cache**: key `sha256(tool + params + contractVersion)`; TTLs search 5m /
  fetch+extract 1h / research 1d; hits keep original `fetchedAt` + `cached: true`.
- **Caps fail closed** with error codes, never truncated success.

## Tests

```bash
bun test packages/opencode-gateway/packages/contract-client/test packages/opencode-gateway/apps/gateway/test packages/opencode-gateway/packages/opencode-guard/test
```

## Issue closure notes (v1.0.0 readiness)

- **#19 (contract as a package)**: closed by `packages/contract-client`
  (`@heretek-ai/gateway-contract` 1.0.0) — Zod schemas for all four tools,
  typed `/mcp` client (initialize negotiation, `Retry-After` retries, sha256
  verification), vendored golden fixtures with hash check.
- **#18 (OpenCode plugin rewrite)**: closed by `packages/opencode-guard`
  (`@heretek-ai/gateway-guard`) — rewritten against pinned
  `@opencode/plugin` **2.0.26 exact** (v2 `define` + `tool.hook` +
  `mcp.transform` API), strict tool guards with gateway-only allowlist, lane
  egress fallback documented in its README.
- **#20 (first release tag)**: this package is cut as `v1.0.0` — fixtures
  frozen, conformance green, CHANGELOG finalized. Tags are human-only;
  automation must never push `main` or create tags.
