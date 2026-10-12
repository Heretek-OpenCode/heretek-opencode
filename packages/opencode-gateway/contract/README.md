# Contract versions

The gateway's `/mcp` contract is versioned independently of package versions.
Every `/mcp` response carries `X-Swarm-Contract: N` and `initialize` reports
`serverInfo.contractVersion: N`.

## Rules

- **Additive** (new optional fields, new tools, new error codes, new
  fixtures): same version. Consumers keep working; fixtures grow.
- **Breaking** (remove/rename a field, change semantics, new required
  params): new version (`X-Swarm-Contract: N+1`, new `contract/vN/`
  directory), announced in advance. The old version stays served until
  consumers migrate (decided at bump time).
- Every behaviour change ships regenerated fixtures in the same change
  (the fixture conformance test enforces this).
- Legacy field mapping (scraper-swarm v1 → this contract): `fetched_at` →
  `fetchedAt`, `content_sha256` (bare hex) → `provenance.contentHash`
  (`sha256:`-prefixed), `web_search`/`fetch_page`/`deep_research` →
  `search`/`fetch`/`research_report` (+ new `extract_structured`).

## Layout

`contract/vN/fixtures/<area>/<case>.json` — golden
`{contract_version, request, response_status, response_headers,
response_body}` pairs. Current: [`v1/`](v1/README.md).
