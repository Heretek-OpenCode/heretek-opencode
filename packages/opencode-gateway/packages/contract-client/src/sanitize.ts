import { createHash } from "node:crypto";
import { EnvelopeSchema, type UntrustedEnvelope } from "./schemas.js";

/** Zero-width / invisible code points stripped from all web content. */
// Mission minimum is U+200B-U+200F + U+FEFF; U+2060-U+2064 (word joiner + invisible
// operators), U+180E and U+00AD (soft hyphen) are included as they are abused the same way.
export const ZERO_WIDTH_RE = /[\u200B-\u200F\uFEFF\u2060-\u2064\u180E\u00AD]/g;

/**
 * Instruction-override patterns replaced with `[removed]`.
 * Conservative by design: only canonical jailbreak phrasings, so legitimate
 * prose (docs about prompt injection included) keeps working.
 */
export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /forget\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /you\s+are\s+now\s+[a-z0-9 _-]{1,80}/gi,
  /do\s+anything\s+now/gi,
  /developer\s+mode/gi,
];

export function sanitizeContent(raw: string): string {
  let out = raw.replace(ZERO_WIDTH_RE, "");
  for (const re of INJECTION_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, "[removed]");
  }
  return out;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function verifyContentHash(content: string, contentHash: string): boolean {
  const m = /^sha256:([0-9a-f]{64})$/.exec(contentHash);
  if (!m) return false;
  return sha256Hex(content) === m[1];
}

export interface EnvelopeInput {
  url: string;
  engine: string;
  rawContent: string;
  fetchedAt?: string;
}

/**
 * Builds the prompt-injection defense envelope. Sanitization runs FIRST and
 * the hash covers the sanitized bytes, so `verifyContentHash` attests exactly
 * what the LLM will see. `trust` is always the literal `"untrusted"`.
 */
export function makeEnvelope(input: EnvelopeInput): UntrustedEnvelope {
  const content = sanitizeContent(input.rawContent);
  const envelope = {
    provenance: {
      url: input.url,
      fetchedAt: input.fetchedAt ?? new Date().toISOString(),
      engine: input.engine,
      contentHash: `sha256:${sha256Hex(content)}`,
    },
    trust: "untrusted" as const,
    content,
  };
  return EnvelopeSchema.parse(envelope);
}
