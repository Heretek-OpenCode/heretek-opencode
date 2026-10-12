/**
 * Host adapter: drives one `opencode serve` instance over its REST API.
 * The host is the execution substrate inside a lane — never the scheduler,
 * never the source of truth for mission state (the journal is).
 *
 * Session model: prompt admission is async (returns an inbox item);
 * delivery is steer|queue; the experimental wait barrier is race-free
 * but optional — polling `messages` is the fallback.
 */

export interface HostOptions {
  readonly baseUrl: string;
  readonly password?: string;
  readonly authToken?: string;
  readonly fetchImpl?: typeof fetch;
  readonly pollIntervalMs?: number;
}

export interface PromptResult {
  readonly sessionId: string;
  readonly messageId?: string;
}

export interface DiffEntry {
  readonly file: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status: string;
}

export class HostError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HostError";
  }
}

export class HostAdapter {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly headers: Record<string, string>;

  constructor(opts: HostOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1500;
    this.headers = { "content-type": "application/json" };
    if (opts.password) {
      this.headers["authorization"] = `Basic ${Buffer.from(`opencode:${opts.password}`).toString("base64")}`;
    }
    if (opts.authToken) this.headers["x-auth-token"] = opts.authToken;
  }

  private url(p: string): string {
    return `${this.base}${p}`;
  }

  private async call<T>(method: string, p: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(p), {
        method,
        headers: this.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new HostError(`host unreachable at ${this.base}: ${(err as Error).message}`);
    }
    if (!res.ok) throw new HostError(`${method} ${p} -> ${res.status}`, res.status);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Enqueue a prompt into a session (async admission). */
  prompt(sessionId: string, text: string, opts: { agent?: string; model?: string } = {}): Promise<PromptResult> {
    return this.call<PromptResult>("POST", `/api/session/${sessionId}/prompt`, {
      text,
      agent: opts.agent,
      model: opts.model,
    });
  }

  /** Steer or queue delivery of an admitted prompt. */
  steer(sessionId: string, mode: "steer" | "queue" = "steer"): Promise<unknown> {
    return this.call("POST", `/api/session/${sessionId}/steer`, { mode });
  }

  /** Race-free idle barrier when the host offers it; polling fallback otherwise. */
  async waitIdle(sessionId: string, timeoutMs = 600_000): Promise<void> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      await this.fetchImpl(this.url(`/api/experimental/session/${sessionId}/wait`), {
        method: "POST",
        headers: this.headers,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      return;
    } catch {
      await this.pollIdle(sessionId, timeoutMs);
    }
  }

  private async pollIdle(sessionId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastCount = -1;
    let stable = 0;
    while (Date.now() < deadline) {
      const messages = await this.messages(sessionId).catch(() => []);
      if (messages.length === lastCount) {
        if (++stable >= 3) return;
      } else {
        stable = 0;
        lastCount = messages.length;
      }
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
    throw new HostError(`waitIdle timed out after ${timeoutMs}ms`);
  }

  interrupt(sessionId: string): Promise<unknown> {
    return this.call("POST", `/api/session/${sessionId}/interrupt`);
  }

  diff(sessionId: string): Promise<DiffEntry[]> {
    return this.call<DiffEntry[]>("GET", `/api/session/${sessionId}/diff`);
  }

  messages(sessionId: string, limit = 50): Promise<Array<{ id: string; role: string; text?: string }>> {
    return this.call("GET", `/api/session/${sessionId}/message?limit=${limit}`);
  }

  health(): Promise<{ ok: boolean }> {
    return this.call<{ ok: boolean }>("GET", "/api/health").catch(() => ({ ok: false }));
  }
}
