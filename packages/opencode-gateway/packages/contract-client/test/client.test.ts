import { describe, expect, test } from "bun:test";
import { GatewayContractClient } from "../src/client.js";
import { makeEnvelope } from "../src/sanitize.js";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-swarm-contract": "1", ...headers },
  });
}

describe("GatewayContractClient", () => {
  test("initialize negotiates protocol, asserts contract header", async () => {
    const calls: string[] = [];
    const client = new GatewayContractClient({
      baseUrl: "http://gateway:8000",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push(String(url));
        const hdrs = (init?.headers ?? {}) as Record<string, string>;
        const lower: Record<string, string> = {};
        for (const [k, v] of Object.entries(hdrs)) lower[k.toLowerCase()] = String(v);
        expect(lower).toMatchObject({ "x-swarm-contract": "1" });
        return jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "OpencodeGateway", version: "1.0.0", contractVersion: 1 },
          },
        });
      }) as unknown as typeof fetch,
    });
    const res = await client.initialize();
    expect(res.protocolVersion).toBe("2025-06-18");
    expect(res.contractVersion).toBe(1);
    expect(calls[0]).toBe("http://gateway:8000/mcp");
  });

  test("missing contract header throws (version mismatch)", async () => {
    const client = new GatewayContractClient({
      baseUrl: "http://gateway:8000",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: {} } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch,
    });
    await expect(client.initialize()).rejects.toThrow(/contract version mismatch/);
  });

  test("429 honors Retry-After then succeeds", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const client = new GatewayContractClient({
      baseUrl: "http://gateway:8000",
      sleep: async (ms: number) => { sleeps.push(ms); },
      fetchImpl: (async () => {
        n += 1;
        if (n === 1) return jsonResponse({ detail: "slow down" }, 429, { "retry-after": "2" });
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: { tools: [] } });
      }) as unknown as typeof fetch,
    });
    const tools = await client.toolsList();
    expect(tools).toEqual([]);
    expect(n).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  test("callTool validates input, verifies content hash", async () => {
    const env = makeEnvelope({ url: "https://example.com", engine: "crawl4ai", rawContent: "body" });
    const structured = {
      ...env,
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com",
      statusCode: 200,
      contentType: "text/markdown",
      title: "T",
      format: "markdown",
      bytes: 4,
      truncated: false,
    };
    const client = new GatewayContractClient({
      baseUrl: "http://gateway:8000",
      fetchImpl: (async () =>
        jsonResponse({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "body" }], structuredContent: structured } })) as unknown as typeof fetch,
    });
    const res = await client.callTool("fetch", { url: "https://example.com" });
    expect(res.isError).toBe(false);
    // Client-side input validation fires before any HTTP.
    await expect(client.callTool("fetch", {})).rejects.toThrow();
  });

  test("callTool rejects tampered content (sha256 mismatch)", async () => {
    const env = makeEnvelope({ url: "https://example.com", engine: "crawl4ai", rawContent: "body" });
    const tampered = { ...env, content: "body TAMPERED" };
    const structured = {
      ...tampered,
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com",
      statusCode: 200,
      contentType: "text/markdown",
      title: "T",
      format: "markdown",
      bytes: 13,
      truncated: false,
    };
    const client = new GatewayContractClient({
      baseUrl: "http://gateway:8000",
      fetchImpl: (async () =>
        jsonResponse({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "x" }], structuredContent: structured } })) as unknown as typeof fetch,
    });
    await expect(client.callTool("fetch", { url: "https://example.com" })).rejects.toThrow(/sha256 mismatch/);
  });
});
