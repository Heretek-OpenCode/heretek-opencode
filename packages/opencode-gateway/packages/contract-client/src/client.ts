import {
  CONTRACT_HEADER,
  CONTRACT_VERSION,
  JsonRpcErrorSchema,
  JsonRpcSuccessSchema,
  MCP_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  parseToolInput,
  parseToolOutput,
  type ToolName,
} from "./schemas.js";
import { verifyContentHash } from "./sanitize.js";

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  baseUrl: string;
  token?: string;
  contractVersion?: number;
  fetchImpl?: FetchImpl;
  /** Max retries on 429 honoring Retry-After. Default 3. */
  maxRetries?: number;
  /** Upper bound for a single Retry-After sleep (ms). Default 10_000. */
  maxRetryAfterMs?: number;
  /** Sleep hook (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
}

export interface CallResult {
  text: string;
  structured: Record<string, unknown>;
  isError: boolean;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    [CONTRACT_HEADER]: String(CONTRACT_VERSION),
  };
  if (token) h["authorization"] = `Bearer ${token}`;
  return h;
}

/**
 * Typed MCP client for POST /mcp (JSON-RPC 2.0).
 * - Sends `X-Swarm-Contract: 1` on every request; asserts it on responses.
 * - `initialize` negotiates the protocol version (falls back to latest known).
 * - 429s are retried honoring `Retry-After` (seconds), bounded by maxRetries.
 * - Tool outputs carrying `provenance.contentHash` are sha256-verified.
 */
export class GatewayContractClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly expectedContract: number;
  private readonly fetchImpl: FetchImpl;
  private readonly maxRetries: number;
  private readonly maxRetryAfterMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private idSeq = 1;
  private negotiatedProtocol: string | null = null;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.expectedContract = opts.contractVersion ?? CONTRACT_VERSION;
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.maxRetries = opts.maxRetries ?? 3;
    this.maxRetryAfterMs = opts.maxRetryAfterMs ?? 10_000;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get protocolVersion(): string | null {
    return this.negotiatedProtocol;
  }

  private async post(body: unknown): Promise<Response> {
    const url = `${this.baseUrl}/mcp`;
    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(url, {
        method: "POST",
        headers: headers(this.token),
        body: JSON.stringify(body),
      });
      if (res.status !== 429 || attempt >= this.maxRetries) return res;
      const retryAfter = res.headers.get("retry-after");
      const secs = retryAfter !== null ? Number.parseInt(retryAfter, 10) : Number.NaN;
      const waitMs = Number.isFinite(secs) && secs >= 0 ? Math.min(secs * 1000, this.maxRetryAfterMs) : 1000;
      attempt += 1;
      await this.sleep(waitMs);
    }
  }

  private assertContract(res: Response): void {
    const got = res.headers.get(CONTRACT_HEADER.toLowerCase());
    if (got !== String(this.expectedContract)) {
      throw new Error(`contract version mismatch: expected ${CONTRACT_HEADER}: ${this.expectedContract}, got ${got ?? "(missing)"}`);
    }
  }

  async initialize(clientProtocol: string = MCP_PROTOCOL_VERSION): Promise<{ protocolVersion: string; contractVersion: number }> {
    const id = this.idSeq++;
    const res = await this.post({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: clientProtocol } });
    this.assertContract(res);
    const body: unknown = await res.json();
    const parsed = JsonRpcSuccessSchema.parse(body);
    // initialize carries protocolVersion/serverInfo at the top level of
    // result (only tools/call uses content/structuredContent).
    const result = parsed.result as unknown as {
      protocolVersion?: string;
      serverInfo?: { contractVersion?: number };
    };
    const serverProtocol = result.protocolVersion ?? "";
    this.negotiatedProtocol = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(serverProtocol)
      ? serverProtocol
      : MCP_PROTOCOL_VERSION;
    return {
      protocolVersion: this.negotiatedProtocol,
      contractVersion: result.serverInfo?.contractVersion ?? this.expectedContract,
    };
  }

  async toolsList(): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>> {
    const id = this.idSeq++;
    const res = await this.post({ jsonrpc: "2.0", id, method: "tools/list", params: {} });
    this.assertContract(res);
    const body: unknown = await res.json();
    const parsed = JsonRpcSuccessSchema.parse(body);
    // tools/list carries `tools` at the top level of result.
    const tools = (parsed.result as unknown as { tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }).tools;
    if (!Array.isArray(tools)) throw new Error("tools/list: missing tools array");
    return tools;
  }

  /**
   * Calls a tool: validates input with Zod BEFORE sending, validates output
   * AFTER receiving, and verifies `provenance.contentHash` over `content`.
   */
  async callTool(name: ToolName, args: unknown): Promise<CallResult> {
    const validArgs = parseToolInput(name, args);
    const id = this.idSeq++;
    const res = await this.post({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: validArgs } });
    this.assertContract(res);
    const body: unknown = await res.json();
    if (res.status >= 400) {
      const err = JsonRpcErrorSchema.parse(body);
      throw new Error(`tools/call ${name} failed: ${err.error.code} ${err.error.message}`);
    }
    const parsed = JsonRpcSuccessSchema.parse(body);
    const text = (parsed.result.content ?? []).map((c) => c.text).join("\n");
    const structured = parsed.result.structuredContent;
    if (!structured || typeof structured !== "object") {
      throw new Error(`tools/call ${name} failed: missing structuredContent`);
    }
    const isError = parsed.result.isError === true;
    if (!isError) {
      parseToolOutput(name, structured);
      const prov = (structured as { provenance?: { contentHash?: string }; content?: unknown }).provenance;
      if (prov && typeof prov.contentHash === "string" && typeof structured["content"] === "string") {
        if (!verifyContentHash(structured["content"] as string, prov.contentHash)) {
          throw new Error(`content verification failed for tool ${name}: sha256 mismatch`);
        }
      }
    }
    return { text, structured, isError };
  }
}
