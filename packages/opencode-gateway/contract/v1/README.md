# Contract v1 fixtures

Golden request/response pairs for the gateway's `/mcp` contract v1, for
external consumers to vendor and test their client against **without running
this stack**.

## Vendoring

1. Copy this directory at a pinned commit: record the source commit hash next
   to your copy (e.g. `fixtures-from: opencode-gateway@<sha>`).
2. Match on `request` → assert `response_status`, the `response_headers`
   subset (`x-swarm-contract`, plus `retry-after` for 429s), and
   `response_body`.
3. Volatile fields are normalized: `fetchedAt` is always `<fetchedAt>`,
   `Retry-After` is always `<retry_after_s>` (assert presence, not value).
4. `contentHash` values are REAL sha256 digests over the fixture `content`
   strings — recompute and compare; a mismatch means tampered bytes.
5. Re-vendor on every contract-version bump (see versioning rules in
   `contract/README.md`).

## Coverage

Every tool (`search`, `fetch`, `extract_structured`, `research_report`, plus
`initialize` and `tools/list`) and the produced error codes (`ssrf_denied`,
`upstream_error`, `upstream_timeout`, `rate_limited`, `scope_denied`,
`engine_unavailable`, `-32601`, `-32602`). `blocked_by_policy` is reserved
(no producer yet).

## Conformance

`packages/contract-client/test/fixtures.test.ts` asserts every fixture
validates against the Zod output schemas and that success-fixture
`contentHash` values verify. Regenerate hashes with the fixture generator
(delta: content strings in `/tmp/gen_fixtures.py` pattern) whenever a
fixture's `content` changes.
