/** Bun entrypoint: serves the hardened gateway. */
import { lookup } from "node:dns/promises";
import { handleMcp } from "./server.js";

const PORT = Number(process.env["GATEWAY_PORT"] ?? 8000);
const TOKEN = process.env["GATEWAY_TOKEN"] ?? "dev-token";
if (!process.env["GATEWAY_TOKEN"]) {
  console.warn("[gateway] GATEWAY_TOKEN unset — using dev default; set it in production.");
}

async function resolve(host: string): Promise<string[]> {
  try {
    const recs = await lookup(host, { all: true });
    return recs.map((r) => r.address);
  } catch {
    return [];
  }
}

const deps = {
  scopesFor: (token: string | null): string[] | null =>
    token === TOKEN ? ["search", "scrape", "admin"] : null,
  resolve,
  fetchEngine: (url: string, init?: RequestInit) => fetch(url, init),
};

function bearerOf(req: Request): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

export default {
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }
    if (req.method === "GET" && url.pathname === "/ready") {
      return Response.json({ ready: true, contractVersion: 1, engines: ["searxng", "crawl4ai", "scrapling", "gpt-researcher"] });
    }
    if (url.pathname === "/mcp" && req.method === "POST") {
      const raw = await req.text();
      const out = await handleMcp(raw, bearerOf(req), deps);
      if (out.status === 202) {
        return new Response(null, { status: 202, headers: out.headers });
      }
      return new Response(out.body === null ? null : JSON.stringify(out.body), {
        status: out.status,
        headers: out.headers,
      });
    }
    return new Response("not found", { status: 404 });
  },
};

console.log(`[gateway] listening on :${PORT} (POST /mcp, GET /ready, GET /health)`);
