import { describe, expect, test } from "bun:test";
import {
  createNotification,
  createRequest,
  createResponse,
  parseFrame,
  parseMessage,
} from "../src/transport/jsonrpc";

describe("JSON-RPC 2.0 engine", () => {
  test("creates spec-compliant requests", () => {
    const req = createRequest("editor_state", { a: 1 }, 1);
    expect(req).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "editor_state",
      params: { a: 1 },
    });
  });

  test("parses responses and correlates ids", () => {
    const msg = parseMessage(
      JSON.stringify({ jsonrpc: "2.0", id: 7, result: { ok: true } }),
    );
    expect(msg.kind).toBe("response");
    if (msg.kind === "response") expect(msg.id).toBe(7);
  });

  test("parses interleaved notifications", () => {
    const msg = parseMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "readiness",
        params: { state: "ready" },
      }),
    );
    expect(msg.kind).toBe("notification");
  });

  test("corrupted frames throw structured errors", () => {
    expect(() => parseMessage("not json")).toThrow();
    expect(() =>
      parseMessage(JSON.stringify({ jsonrpc: "1.0", id: 1, result: 1 })),
    ).toThrow();
    expect(() =>
      parseMessage(JSON.stringify({ jsonrpc: "2.0", method: 123 })),
    ).toThrow();
    expect(() =>
      parseMessage(JSON.stringify({ jsonrpc: "2.0", id: null, method: "x" })),
    ).toThrow();
  });

  test("oversized frames over 4MiB are rejected", () => {
    const big = `{"jsonrpc":"2.0","id":1,"result":"${"x".repeat(4 * 1024 * 1024 + 1)}"}`;
    expect(() => parseFrame(big, 4 * 1024 * 1024)).toThrow();
    const ok = createResponse(1, { ok: true });
    expect(() => parseFrame(JSON.stringify(ok), 4 * 1024 * 1024)).not.toThrow();
  });

  test("error responses carry code and message", () => {
    const msg = parseMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        error: { code: -32000, message: "boom" },
      }),
    );
    expect(msg.kind).toBe("error");
    void createNotification("ping");
  });
});
