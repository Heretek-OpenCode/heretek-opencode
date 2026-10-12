# gdevelop-byok skill (pack-gdevelop)

Applies when the operator asks for GDevelop AI assistance.

1. BYOK only: the API key lives in memory for the session. Never persist it,
   never send project content to hosted storage (no S3 presigned uploads).
2. If the request cannot be served locally, say so and stop — do not silently
   fall back to a hosted endpoint.
3. Patch-stack changes go through `bun run verify-patches` before anything
   else; a patch that does not apply cleanly is a hard stop.
