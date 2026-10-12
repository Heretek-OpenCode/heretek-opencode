import { describe, expect, test } from "bun:test";
import { generateCapabilities } from "../src/security/capability";
import {
  createHandshakeProof,
  generateNonce,
  verifyHandshakeProof,
  verifyMutualHandshake,
} from "../src/security/handshake";

describe("HMAC mutual handshake", () => {
  test("valid proof verifies over canonical transcript", () => {
    const caps = generateCapabilities();
    const nonce = generateNonce();
    const proof = createHandshakeProof(
      caps.wsCapability,
      nonce,
      9500,
      "server",
    );
    expect(
      verifyHandshakeProof(caps.wsCapability, nonce, 9500, "server", proof),
    ).toBe(true);
  });

  test("tampered nonce fails", () => {
    const caps = generateCapabilities();
    const nonce = generateNonce();
    const proof = createHandshakeProof(
      caps.wsCapability,
      nonce,
      9500,
      "server",
    );
    const bad = nonce.slice(0, -1) + (nonce.endsWith("0") ? "1" : "0");
    expect(
      verifyHandshakeProof(caps.wsCapability, bad, 9500, "server", proof),
    ).toBe(false);
  });

  test("wrong port / role fails", () => {
    const caps = generateCapabilities();
    const nonce = generateNonce();
    const proof = createHandshakeProof(
      caps.wsCapability,
      nonce,
      9500,
      "server",
    );
    expect(
      verifyHandshakeProof(caps.wsCapability, nonce, 9501, "server", proof),
    ).toBe(false);
    expect(
      verifyHandshakeProof(caps.wsCapability, nonce, 9500, "client", proof),
    ).toBe(false);
  });

  test("wrong secret fails, malformed proof fails", () => {
    const caps = generateCapabilities();
    const other = generateCapabilities();
    const nonce = generateNonce();
    const proof = createHandshakeProof(
      caps.wsCapability,
      nonce,
      9500,
      "server",
    );
    expect(
      verifyHandshakeProof(other.wsCapability, nonce, 9500, "server", proof),
    ).toBe(false);
    expect(
      verifyHandshakeProof(caps.wsCapability, nonce, 9500, "server", "zzzz"),
    ).toBe(false);
    expect(
      verifyHandshakeProof(caps.wsCapability, nonce, 9500, "server", ""),
    ).toBe(false);
  });

  test("mutual handshake requires both directions", () => {
    const caps = generateCapabilities();
    const nonce = generateNonce();
    const serverProof = createHandshakeProof(
      caps.wsCapability,
      nonce,
      9500,
      "server",
    );
    const clientProof = createHandshakeProof(
      caps.httpCapability,
      nonce,
      9500,
      "client",
    );
    expect(
      verifyMutualHandshake(caps, nonce, 9500, { serverProof, clientProof }),
    ).toBe(true);
    expect(
      verifyMutualHandshake(caps, nonce, 9500, {
        serverProof: "00",
        clientProof,
      }),
    ).toBe(false);
  });
});
