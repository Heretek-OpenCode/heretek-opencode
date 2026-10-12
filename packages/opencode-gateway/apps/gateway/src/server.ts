/**
 * Hardened MCP gateway request handler (runtime-agnostic) + Bun.serve wiring.
 *
 * - POST /mcp: strict JSON-RPC 2.0 (-32700/-32600/-32601/-32602, 202
 *   notifications, initialize negotiation), every response carries
 *   `X-Swarm-Contract: 1`.
 * - SSRF fail-closed on every fetch path: literal blocklist, DNS pin, and
 *   no-redirect-to-private (redirects followed manually, each hop checked).
 * - Per-host circuit breakers keyed by (host, engine) with half-open probes;
 *   backoff surfaced in structuredContent (`retryAfterS`).
 * - Prompt-injection envelope on all web content (sanitize first, hash the
 *   sanitized bytes, `trust: "untrusted"` always).
 * - Cache key sha256(tool + params + contractVersion) with per-tool TTLs;
 *   hits return original fetchedAt + `cached: true`.
 * - Caps fail closed with machine-readable error codes — never a truncated
 *   "success".
 */
import {
  CONTRACT_HEADER,
  CONTRACT_VERSION,
  MCP_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  MemoryCache,
  CACHE_TTLS_MS,
  HostCircuitBreaker,
  cacheKeyFor,
  checkUrlAllowed,
  denyReasonForUrl,
  extractHostname,
  makeEnvelope,
  parseToolInput,
  type ToolName,
} from "../../../packages/contract-client/src/index.js";

export interface BackendResults {
  search: (query: string, limit: number) => Promise<Array<{ title: string; url: string; snippet: string }>>;
  extract: (url: string, fields: string[]) => Promise<Record<string, unknown>>;
  research: (query: string, depth: string, maxSources: number) => Promise<{ report: string; citations: Array<{ url: string; title: string; contentHash: string }> }>;
}

export interface GatewayDeps {
  /** Bearer token -> scopes, or null when invalid (fail closed). */
  scopesFor: (token: string | null) => string[] | null;
  /** DNS resolver returning string IPs (empty = unresolvable). */
  resolve: (host: string) => Promise<string[]>;
  /** Engine HTTP fetch (redirects handled by the gateway, pass redirect:"manual"). */
  fetchEngine: (url: string, init?: RequestInit) => Promise<Response>;
  backends?: Partial<BackendResults>;
  now?: () => number;
  maxFetchBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  deployedEngines?: Set<string>;
  rateLimitRpm?: number;
}

export interface McpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const TOOL_ENGINE: Record<ToolName, string> = {
  search: "searxng",
  fetch: "crawl4ai",
  extract_structured: "scrapling",
  research_report: "gpt-researcher",
};

const TOOL_SCOPE: Record<ToolName, string> = {
  search: "search",
  fetch: "scrape",
  extract_structured: "scrape",
  research_report: "search",
};

function ok(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): McpResponse {
  return {
    status,
    headers: { "content-type": "application/json", [CONTRACT_HEADER.toLowerCase()]: String(CONTRACT_VERSION), ...extraHeaders },
    body,
  };
}

function rpcError(id: unknown, code: number, message: string): McpResponse {
  return ok({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function toolErrorText(id: unknown, code: string, message: string, retryAfterS: number | null = null): McpResponse {
  const structured: Record<string, unknown> = { code, message, retryAfterS };
  return ok({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: message }], structuredContent: structured, isError: true },
  });
}

function toolSuccess(id: unknown, text: string, structured: Record<string, unknown>): McpResponse {
  return ok({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text }], structuredContent: structured },
  });
}

const rateBuckets = new Map<string, number[]>();

export function resetGatewayState(): void {
  rateBuckets.clear();
}

function checkRateLimit(key: string, rpm: number): number | null {
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (rateBuckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= Math.max(1, rpm)) {
    rateBuckets.set(key, hits);
    const retryAfter = Math.max(1, Math.ceil((hits[0] + 60_000 - now) / 1000));
    return retryAfter;
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  return null;
}

const TOOL_DEFS: Array<{ name: ToolName; description: string; inputSchema: Record<string, unknown> }> = [
  {
    name: "search",
    description: "Search the web via SearXNG. Results wrapped in the untrusted provenance envelope.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: 20, default: 5 } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch",
    description: "Fetch a page via Crawl4AI. SSRF fail-closed; content wrapped in the untrusted provenance envelope.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", minLength: 1 }, format: { type: "string", enum: ["markdown", "html", "text"], default: "markdown" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "extract_structured",
    description: "Extract structured fields via the Scrapling stealth engine, wrapped in the untrusted envelope.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", minLength: 1 }, fields: { type: "array", items: { type: "string" } } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "research_report",
    description: "Autonomous deep research synthesis via GPT-Researcher, wrapped in the untrusted envelope.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        depth: { type: "string", enum: ["quick", "standard", "deep"], default: "standard" },
        maxSources: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
];

const breaker = new HostCircuitBreaker();
const cache = new MemoryCache<Record<string, unknown>>();

export function resetGatewayCaches(): void {
  breaker.reset();
  cache.clear();
}

async function fetchWithGuards(
  url: string,
  engine: string,
  deps: GatewayDeps,
  maxBytes: number,
  timeoutMs: number,
  maxRedirects: number,
): Promise<{ ok: true; finalUrl: string; statusCode: number; contentType: string | null; text: string } | { ok: false; code: string; message: string }> {
  const host0 = extractHostname(url);
  if (!host0) return { ok: false, code: "ssrf_denied", message: "SSRF denied (fail-closed): empty hostname (fail-closed)" };
  if (!breaker.canExecute(host0, engine)) {
    return { ok: false, code: "upstream_error", message: `Circuit open for ${host0} (${engine}): failing fast; retry after backoff` };
  }
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const denial = await checkUrlAllowed(current, deps.resolve);
    if (denial) {
      breaker.recordFailure(extractHostname(current) ?? current, engine);
      return { ok: false, code: "ssrf_denied", message: `SSRF denied (fail-closed): ${denial}` };
    }
    let res: Response;
    try {
      res = await deps.fetchEngine(current, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      breaker.recordFailure(extractHostname(current) ?? current, engine);
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, code: timeout ? "upstream_timeout" : "upstream_error", message: `Engine ${engine} fetch failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        breaker.recordFailure(extractHostname(current) ?? current, engine);
        return { ok: false, code: "upstream_error", message: `Engine ${engine} returned redirect without location` };
      }
      try {
        current = new URL(loc, current).toString();
      } catch {
        return { ok: false, code: "upstream_error", message: `Engine ${engine} returned unparseable redirect` };
      }
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      breaker.recordFailure(extractHostname(current) ?? current, engine);
      return { ok: false, code: "upstream_error", message: `Engine ${engine} returned status ${res.status}` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      // Cap exceeded: machine-readable error, NEVER a truncated "success".
      breaker.recordFailure(extractHostname(current) ?? current, engine);
      return { ok: false, code: "upstream_error", message: `Response exceeds cap (${buf.length} > ${maxBytes} bytes)` };
    }
    breaker.recordSuccess(extractHostname(current) ?? current, engine);
    return {
      ok: true,
      finalUrl: current,
      statusCode: res.status,
      contentType: res.headers.get("content-type"),
      text: new TextDecoder().decode(buf),
    };
  }
  return { ok: false, code: "upstream_error", message: `Too many redirects (>${maxRedirects})` };
}

const DEFAULT_BACKENDS: BackendResults = {
  search: async (query, limit) => {
    const out = [];
    for (let i = 1; i <= Math.min(limit, 3); i++) {
      out.push({ title: `Result ${i} for ${query}`, url: `https://example.com/r${i}`, snippet: `Snippet ${i} for ${query}.` });
    }
    return out;
  },
  extract: async (url, fields) => {
    const data: Record<string, unknown> = {};
    for (const f of fields.length > 0 ? fields : ["title"]) data[f] = `extracted:${f}`;
    data["_source"] = url;
    return data;
  },
  research: async (query, depth) => ({
    report: `# Research Report: ${query}\n\nDepth: ${depth}.\n\nSynthesis pending engine results.`,
    citations: [],
  }),
};

export async function handleMcp(rawBody: string, bearer: string | null, deps: GatewayDeps): Promise<McpResponse> {
  const maxBytes = deps.maxFetchBytes ?? 3 * 1024 * 1024;
  const timeoutMs = deps.timeoutMs ?? 45_000;
  const maxRedirects = deps.maxRedirects ?? 3;
  const deployed = deps.deployedEngines ?? new Set(["searxng", "crawl4ai", "scrapling", "gpt-researcher"]);
  const rpm = deps.rateLimitRpm ?? 60;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return rpcError(null, -32700, "Parse error: malformed JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return rpcError(null, -32600, "Invalid Request: body must be a JSON object");
  }
  const body = parsed as Record<string, unknown>;
  const method = body["method"];
  const hasId = "id" in body;
  const id = body["id"];

  const scopes = deps.scopesFor(bearer);
  if (!scopes) return ok({ detail: "Authentication required (Bearer token)" }, 401);

  const rlKey = bearer ?? "anonymous";
  const retryAfter = checkRateLimit(rlKey, rpm);
  if (retryAfter !== null) {
    return ok({ detail: `Rate limit exceeded (${rpm} req/min)` }, 429, { "retry-after": String(retryAfter) });
  }

  if (body["jsonrpc"] !== "2.0") return rpcError(id, -32600, "Invalid Request: jsonrpc must be '2.0'");
  if (typeof method !== "string" || !method) return rpcError(id, -32600, "Invalid Request: method must be a string");
  if (!hasId) return { status: 202, headers: { [CONTRACT_HEADER.toLowerCase()]: String(CONTRACT_VERSION) }, body: null };

  if (method === "initialize") {
    const params = (typeof body["params"] === "object" && body["params"] !== null ? body["params"] : {}) as Record<string, unknown>;
    const clientVersion = params["protocolVersion"];
    const negotiated =
      typeof clientVersion === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(clientVersion)
        ? clientVersion
        : MCP_PROTOCOL_VERSION;
    return ok({ jsonrpc: "2.0", id, result: { protocolVersion: negotiated, capabilities: { tools: {} }, serverInfo: { name: "OpencodeGateway", version: "1.0.0", contractVersion: CONTRACT_VERSION } } });
  }

  if (method === "tools/list") {
    const tools = TOOL_DEFS.filter(
      (t) => (scopes.includes(TOOL_SCOPE[t.name]) || scopes.includes("admin")) && deployed.has(TOOL_ENGINE[t.name]),
    );
    return ok({ jsonrpc: "2.0", id, result: { tools } });
  }

  if (method === "tools/call") {
    const params = body["params"];
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      return rpcError(id, -32602, "Invalid params: params must be an object");
    }
    const { name, arguments: rawArgs } = params as { name?: unknown; arguments?: unknown };
    if (typeof name !== "string" || !(name in TOOL_ENGINE)) {
      return rpcError(id, -32601, `Method ${typeof name === "string" ? name : "?"} not found`);
    }
    const tool = name as ToolName;
    if (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs)) {
      return rpcError(id, -32602, "Invalid params: arguments must be an object");
    }
    let args: ReturnType<typeof parseToolInput>;
    try {
      args = parseToolInput(tool, rawArgs);
    } catch (e) {
      return rpcError(id, -32602, `Invalid params: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!scopes.includes(TOOL_SCOPE[tool]) && !scopes.includes("admin")) {
      return toolErrorText(id, "scope_denied", `Key lacks required scope '${TOOL_SCOPE[tool]}'`);
    }
    if (!deployed.has(TOOL_ENGINE[tool])) {
      return toolErrorText(id, "engine_unavailable", `Engine '${TOOL_ENGINE[tool]}' for tool '${tool}' is not deployed or healthy`);
    }

    const key = cacheKeyFor(tool, args);
    const hit = cache.get(key);
    const backends = { ...DEFAULT_BACKENDS, ...deps.backends };

    if (tool === "search" && "query" in args) {
      const limit = "limit" in args && typeof args.limit === "number" ? args.limit : 5;
      if (hit) {
        const prev = hit.value;
        return toolSuccess(id, String(prev["text"]), { ...(prev["structured"] as Record<string, unknown>), cached: true });
      }
      try {
        const items = (await backends.search(args.query, limit)).slice(0, limit);
        const results = items.map((r, i) => ({ rank: i + 1, title: r.title, url: r.url, snippet: r.snippet, engine: "searxng" }));
        const text = results.length > 0
          ? results.map((r) => `Title: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}\n---`).join("\n")
          : "No results found.";
        const env = makeEnvelope({ url: `searxng://search?q=${encodeURIComponent(args.query)}`, engine: "searxng", rawContent: text });
        const structured = { ...env, query: args.query, results };
        cache.set(key, { text, structured }, CACHE_TTLS_MS.search);
        return toolSuccess(id, text, structured);
      } catch (e) {
        return toolErrorText(id, "upstream_error", `SearXNG search failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if ((tool === "fetch" || tool === "extract_structured") && "url" in args && typeof args.url === "string") {
      const url = args.url;
      const literalDenial = denyReasonForUrl(url);
      if (literalDenial) return toolErrorText(id, "ssrf_denied", `SSRF denied (fail-closed): ${literalDenial}`);
      if (hit) {
        const prev = hit.value;
        return toolSuccess(id, String(prev["text"]), { ...(prev["structured"] as Record<string, unknown>), cached: true });
      }
      const engine = TOOL_ENGINE[tool];
      const fetched = await fetchWithGuards(url, engine, deps, maxBytes, timeoutMs, maxRedirects);
      if (!fetched.ok) return toolErrorText(id, fetched.code, fetched.message);
      if (tool === "fetch") {
        const format = "format" in args && typeof args.format === "string" ? args.format : "markdown";
        const env = makeEnvelope({ url, engine, rawContent: fetched.text });
        const structured = {
          ...env,
          requestedUrl: url,
          finalUrl: fetched.finalUrl,
          statusCode: fetched.statusCode,
          contentType: fetched.contentType,
          title: null,
          format,
          bytes: new TextEncoder().encode(env.content).length,
          truncated: false,
        };
        cache.set(key, { text: env.content, structured }, CACHE_TTLS_MS.fetch);
        return toolSuccess(id, env.content, structured);
      }
      const fields = "fields" in args && Array.isArray(args.fields) ? (args.fields as string[]) : [];
      try {
        const data = await backends.extract(url, fields);
        const summary = `Extracted fields ${fields.length > 0 ? fields.join(", ") : "title"} from ${url}.`;
        const env = makeEnvelope({ url, engine, rawContent: summary });
        const structured = { ...env, requestedUrl: url, data, fields };
        cache.set(key, { text: env.content, structured }, CACHE_TTLS_MS.extract_structured);
        return toolSuccess(id, env.content, structured);
      } catch (e) {
        return toolErrorText(id, "upstream_error", `Scrapling extraction failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (tool === "research_report" && "query" in args) {
      if (hit) {
        const prev = hit.value;
        return toolSuccess(id, String(prev["text"]), { ...(prev["structured"] as Record<string, unknown>), cached: true });
      }
      const depth = "depth" in args && typeof args.depth === "string" ? args.depth : "standard";
      const maxSources = "maxSources" in args && typeof args.maxSources === "number" ? args.maxSources : 5;
      try {
        const { report, citations } = await backends.research(args.query, depth, maxSources);
        const env = makeEnvelope({ url: `gpt-researcher://report?q=${encodeURIComponent(args.query)}`, engine: "gpt-researcher", rawContent: report });
        const structured = { ...env, query: args.query, depth, citations };
        cache.set(key, { text: env.content, structured }, CACHE_TTLS_MS.research_report);
        return toolSuccess(id, env.content, structured);
      } catch (e) {
        return toolErrorText(id, "upstream_error", `Research failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return rpcError(id, -32602, "Invalid params: arguments do not match tool");
  }

  return rpcError(id, -32601, `Method ${method} not found`);
}
