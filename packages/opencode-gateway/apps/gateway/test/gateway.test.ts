import { describe, expect, test } from "bun:test";
import { handleMcp, resetGatewayCaches, resetGatewayState, type GatewayDeps } from "../src/server.js";

function deps(over: Partial<GatewayDeps> = {}): GatewayDeps {
  return {
    scopesFor: (t) => (t === "good" ? ["search", "scrape"] : null),
    resolve: async () => ["93.184.216.34"],
    fetchEngine: async () =>
      new Response("# Hello\n\nworld", { status: 200, headers: { "content-type": "text/markdown" } }),
    ...over,
  };
}

const call = (name: string, args: unknown, id = 1) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

describe("gateway server", () => {
  test("strict JSON-RPC: parse/invalid/unknown mapped, notifications 202", async () => {
    const d = deps();
    let r = await handleMcp("{oops", "good", d);
    expect((r.body as { error: { code: number } }).error.code).toBe(-32700);
    r = await handleMcp("[1,2]", "good", d);
    expect((r.body as { error: { code: number } }).error.code).toBe(-32600);
    r = await handleMcp(JSON.stringify({ jsonrpc: "2.0", method: "nope" }), "good", d);
    expect(r.status).toBe(202);
    r = await handleMcp(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "nope" }), "good", d);
    expect((r.body as { error: { code: number } }).error.code).toBe(-32601);
    r = await handleMcp(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fetch", arguments: {} } }), "good", d);
    expect((r.body as { error: { code: number } }).error.code).toBe(-32602);
  });

  test("every /mcp response carries X-Swarm-Contract: 1 + auth is fail-closed", async () => {
    const d = deps();
    const r = await handleMcp(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), "good", d);
    expect(r.headers["x-swarm-contract"]).toBe("1");
    const unauth = await handleMcp(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), null, d);
    expect(unauth.status).toBe(401);
  });

  test("fetch wraps content in the untrusted envelope with matching hash", async () => {
    resetGatewayCaches();
    resetGatewayState();
    const r = await handleMcp(call("fetch", { url: "https://example.com/page" }), "good", deps());
    const result = (r.body as { result: { structuredContent: Record<string, unknown>; content: Array<{ text: string }> } }).result;
    expect(result.structuredContent["trust"]).toBe("untrusted");
    const prov = result.structuredContent["provenance"] as { contentHash: string; engine: string };
    expect(prov.engine).toBe("crawl4ai");
    const { createHash } = await import("node:crypto");
    expect(prov.contentHash).toBe(`sha256:${createHash("sha256").update(result.structuredContent["content"] as string, "utf8").digest("hex")}`);
  });

  test("SSRF denied fail-closed (literal + DNS pin + redirect-to-private)", async () => {
    resetGatewayCaches();
    resetGatewayState();
    const d = deps();
    let r = await handleMcp(call("fetch", { url: "http://169.254.169.254/" }), "good", d);
    expect(((r.body as { result: { structuredContent: { code: string } } }).result.structuredContent.code)).toBe("ssrf_denied");

    const privDns = deps({ resolve: async () => ["10.9.9.9"] });
    r = await handleMcp(call("fetch", { url: "https://example.com/" }), "good", privDns);
    expect(((r.body as { result: { structuredContent: { code: string } } }).result.structuredContent.code)).toBe("ssrf_denied");

    const redirector = deps({
      fetchEngine: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }),
    });
    r = await handleMcp(call("fetch", { url: "https://example.com/" }), "good", redirector);
    expect(((r.body as { result: { structuredContent: { code: string } } }).result.structuredContent.code)).toBe("ssrf_denied");
  });

  test("caps return machine-readable errors, never truncated success", async () => {
    resetGatewayCaches();
    resetGatewayState();
    const big = deps({
      maxFetchBytes: 10,
      fetchEngine: async () => new Response("x".repeat(100), { status: 200 }),
    });
    const r = await handleMcp(call("fetch", { url: "https://example.com/big" }), "good", big);
    const result = (r.body as { result: { structuredContent: { code: string; message: string }; isError: boolean } }).result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("upstream_error");
    expect(result.structuredContent.message).toMatch(/exceeds cap/);
  });

  test("scope-denied + engine-unavailable are machine-readable", async () => {
    resetGatewayCaches();
    resetGatewayState();
    const searchOnly = deps({ scopesFor: (t) => (t === "good" ? ["search"] : null) });
    let r = await handleMcp(call("fetch", { url: "https://example.com/" }), "good", searchOnly);
    expect(((r.body as { result: { structuredContent: { code: string } } }).result.structuredContent.code)).toBe("scope_denied");

    const noEngine = deps({ deployedEngines: new Set(["searxng"]) });
    r = await handleMcp(call("fetch", { url: "https://example.com/" }), "good", noEngine);
    expect(((r.body as { result: { structuredContent: { code: string } } }).result.structuredContent.code)).toBe("engine_unavailable");
  });

  test("cache hits preserve fetchedAt and set cached:true", async () => {
    resetGatewayCaches();
    resetGatewayState();
    const d = deps({ backends: { search: async () => [{ title: "T", url: "https://example.com", snippet: "S" }] } });
    const req = call("search", { query: "unique-cache-probe-123" });
    const first = ((await handleMcp(req, "good", d)).body as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    const second = ((await handleMcp(req, "good", d)).body as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    expect(second["cached"]).toBe(true);
    expect((second["provenance"] as { fetchedAt: string }).fetchedAt).toBe((first["provenance"] as { fetchedAt: string }).fetchedAt);
  });

  test("circuit breaker fails fast per (host, engine)", async () => {
    resetGatewayCaches();
    resetGatewayState();
    let calls = 0;
    const flaky = deps({
      fetchEngine: async () => { calls += 1; return new Response("boom", { status: 500 }); },
    });
    // Trip the breaker for the fetch host (default threshold 5).
    for (let i = 0; i < 6; i++) {
      await handleMcp(call("fetch", { url: "https://flaky.example/" }), "good", flaky);
    }
    const before = calls;
    const r = await handleMcp(call("fetch", { url: "https://flaky.example/other" }), "good", flaky);
    expect(calls).toBe(before); // fail-fast: no engine call issued
    expect(((r.body as { result: { structuredContent: { message: string } } }).result.structuredContent.message)).toMatch(/Circuit open/);
  });
});
