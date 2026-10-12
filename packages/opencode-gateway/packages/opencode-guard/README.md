# @heretek-ai/gateway-guard

OpenCode v2 guard plugin (built against `@opencode/plugin` **2.0.26 exact**)
for the hardened web-ingestion gateway.

## What it does

1. **Blocks raw network tools toward arbitrary URLs** (`tool.execute.before`
   hook): fetch/curl/wget/http-class tools, interpreter exfil primitives
   (python/powershell/pwsh/ruby/node/…), and shells carrying fetch intent —
   unless every URL in the call targets the allowlisted gateway host.
2. **Allowlists the gateway only**: default allowlist is the host of
   `GATEWAY_URL` (default `http://gateway:8000`). A fetch-class tool pointed
   solely at the gateway is the sanctioned path, not a bypass.
3. **Registers gateway tools**: adds the hardened gateway as MCP server
   `gateway` (`<GATEWAY_URL>/mcp`), exposing `search`, `fetch`,
   `extract_structured`, `research_report`.

Block messages are generic (tool name only, never the URL) so secret-bearing
query strings are never echoed into error text.

## Fallback to lane egress policy

The editor-side guard is bypassable by construction (novel exfil binaries,
obfuscated one-liners, direct socket use). It is the **inner** layer only.
The **enforcement backstop is lane egress policy**:

- Lanes run with `network: none` except the gateway (proxy env
  `HTTP(S)_PROXY` → Smokescreen; `NO_PROXY` covers declared `direct_peers`
  only).
- The gateway SSRF pre-deny + Smokescreen per-connection checks remain the
  enforcement point for anything the guard misses.
- If the v2 plugin hook surface ever becomes unusable for (1), the decision
  is: stop relying on the plugin for blocking and enforce exclusively via
  lane policy — the stronger guarantee. This fallback is intentional and
  documented here, not a regression.

## Configure

```bash
GATEWAY_URL=http://gateway:8000  # host allowlist source + MCP endpoint
```
