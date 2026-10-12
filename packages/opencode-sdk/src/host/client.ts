/** Typed REST client for the OpenCode v2 host engine (pinned 2.0.26). */

export interface HostClientOptions {
  baseUrl: string;
  /** Injectable fetch for testability. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Poll interval (ms) used by the wait() fallback path. */
  pollIntervalMs?: number;
}

export interface PromptResult {
  inboxId: string;
  raw: unknown;
}

export interface FileDiff {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface HostMessage {
  id: string;
  role: string;
  [key: string]: unknown;
}

export class HostClientError extends Error {
  public readonly status: number;
  public readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "HostClientError";
    this.status = status;
    this.body = body;
  }
}

const DEFAULT_POLL_MS = 1000;

export class HostClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;

  constructor(options: HostClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res: Response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return { status: 204, data: undefined as T };
    const text: string = await res.text();
    if (!res.ok) throw new HostClientError(`host ${method} ${path} failed: ${res.status}`, res.status, text);
    const parsed: unknown = text.length > 0 ? (JSON.parse(text) as unknown) : undefined;
    return { status: res.status, data: parsed as T };
  }

  /** Enqueue a prompt; returns the inbox item (async admission, not an answer). */
  async prompt(sessionId: string, msg: string): Promise<PromptResult> {
    const { data } = await this.request<{ data: { id?: string } & Record<string, unknown> }>(
      "POST",
      `/api/session/${encodeURIComponent(sessionId)}/prompt`,
      { text: msg },
    );
    const inbox = data?.data ?? {};
    return { inboxId: typeof inbox.id === "string" ? inbox.id : "", raw: inbox };
  }

  /**
   * Race-free idle barrier. Uses POST experimental wait; on 404/501
   * (endpoint missing) falls back to polling session.message.list.
   */
  async wait(sessionId: string, timeoutMs: number): Promise<void> {
    const deadline: number = Date.now() + timeoutMs;
    try {
      const controller = new AbortController();
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), timeoutMs);
      try {
        await this.fetchImpl(
          `${this.baseUrl}/api/experimental/session/${encodeURIComponent(sessionId)}/wait`,
          { method: "POST", signal: controller.signal },
        ).then(async (res: Response) => {
          if (res.status === 404 || res.status === 501) throw new HostClientError("wait unavailable", res.status, "");
          if (res.status === 204) return;
          if (!res.ok) throw new HostClientError(`wait failed: ${res.status}`, res.status, await res.text());
        });
        return;
      } finally {
        clearTimeout(timer);
      }
    } catch (err: unknown) {
      if (!(err instanceof HostClientError) || (err.status !== 404 && err.status !== 501)) {
        if (err instanceof HostClientError) throw err;
        // AbortError means our own timeout elapsed: surface as timeout.
        if (err instanceof Error && err.name === "AbortError") {
          throw new HostClientError("wait timed out", 408, "");
        }
      }
      // Fall through to polling fallback.
    }
    await this.pollUntilIdle(sessionId, deadline);
  }

  private async pollUntilIdle(sessionId: string, deadline: number): Promise<void> {
    let lastCount = -1;
    let stableRounds = 0;
    for (;;) {
      if (Date.now() >= deadline) throw new HostClientError("wait timed out", 408, "");
      const messages: HostMessage[] = await this.listMessages(sessionId);
      if (messages.length === lastCount) {
        stableRounds += 1;
        if (stableRounds >= 2) return;
      } else {
        stableRounds = 0;
        lastCount = messages.length;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  async diff(sessionId: string): Promise<FileDiff[]> {
    const { data } = await this.request<{ data: FileDiff[] }>(
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}/diff`,
    );
    return data?.data ?? [];
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.request<unknown>("POST", `/api/session/${encodeURIComponent(sessionId)}/interrupt`);
  }

  async listMessages(sessionId: string): Promise<HostMessage[]> {
    const { data } = await this.request<{ data: HostMessage[] }>(
      "GET",
      `/api/session/${encodeURIComponent(sessionId)}/message`,
    );
    const items: unknown = data?.data;
    return Array.isArray(items) ? (items as HostMessage[]) : [];
  }
}
