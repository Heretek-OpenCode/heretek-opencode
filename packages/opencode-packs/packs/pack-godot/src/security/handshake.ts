// Mutual HMAC-SHA256 handshake over a canonical transcript.
// Transcript: nonce || port || role rendered as "nonce:port:role" (UTF-8).
// Verification uses constant-time comparison.

import { createHmac, getRandomValues, timingSafeEqual } from "node:crypto";
import type { Capabilities } from "./capability";

export type HandshakeRole = "server" | "client";

export function generateNonce(): string {
  return Buffer.from(getRandomValues(new Uint8Array(16))).toString("hex");
}

export function canonicalTranscript(
  nonce: string,
  port: number,
  role: HandshakeRole,
): string {
  if (!/^[0-9a-fA-F]{32}$/.test(nonce))
    throw new Error("nonce must be 32 hex digits");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("port must be 1-65535");
  if (role !== "server" && role !== "client")
    throw new Error("role must be server|client");
  return `${nonce.toLowerCase()}:${port}:${role}`;
}

export function createHandshakeProof(
  secret: string,
  nonce: string,
  port: number,
  role: HandshakeRole,
): string {
  const transcript = canonicalTranscript(nonce, port, role);
  return createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(transcript, "utf8")
    .digest("hex");
}

export function verifyHandshakeProof(
  secret: string,
  nonce: string,
  port: number,
  role: HandshakeRole,
  proofHex: string,
): boolean {
  if (typeof proofHex !== "string" || !/^[0-9a-f]{64}$/.test(proofHex))
    return false;
  let expected: string;
  try {
    expected = createHandshakeProof(secret, nonce, port, role);
  } catch {
    return false;
  }
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(proofHex.toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyMutualHandshake(
  caps: Capabilities,
  nonce: string,
  port: number,
  proofs: { readonly serverProof: string; readonly clientProof: string },
): boolean {
  return (
    verifyHandshakeProof(
      caps.wsCapability,
      nonce,
      port,
      "server",
      proofs.serverProof,
    ) &&
    verifyHandshakeProof(
      caps.httpCapability,
      nonce,
      port,
      "client",
      proofs.clientProof,
    )
  );
}
