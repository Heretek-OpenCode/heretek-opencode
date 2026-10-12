// Native WebSocket RFC6455 client for ws://127.0.0.1:9500 (zero-Python).
// Uses the platform WebSocket (Bun/undici). JSON-RPC id correlation,
// 20s keepalive / 60s timeout, 4 MiB frame ceiling with rejection.

import { MAX_FRAME_BYTES, createRequest, parseMessage } from "./jsonrpc";

export interface BridgeClientOptions {
  readonly pingIntervalMs?: number;
  readonly pongTimeoutMs?: number;
  readonly maxFrameBytes?: number;
}

export type NotificationHandler = (method: string, params: unknown) => void;
export type FrameErrorHandler = (err: Error, raw: string) => void;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export class GodotBridgeClient {
  private readonly url: string;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly maxFrameBytes: number;
  private ws: WebSocket | null = null;
  private readonly pending = new Map<number | string, Pending>();
  private readonly notifications = new Set<NotificationHandler>();
  private readonly frameErrors = new Set<FrameErrorHandler>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastInbound = 0;
  private connectPromise: Promise<void> | null = null;

  constructor(url = "ws://127.0.0.1:9500", options: BridgeClientOptions = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      throw new Error("bridge url must be ws(s)");
    }
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
      throw new Error("bridge url must be loopback");
    }
    this.url = url;
    this.pingIntervalMs = options.pingIntervalMs ?? 20_000;
    this.pongTimeoutMs = options.pongTimeoutMs ?? 60_000;
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES;
  }

  onNotification(fn: NotificationHandler): () => void {
    this.notifications.add(fn);
    return () => this.notifications.delete(fn);
  }

  onFrameError(fn: FrameErrorHandler): () => void {
    this.frameErrors.add(fn);
    return () => this.frameErrors.delete(fn);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const openTimer = setTimeout(() => {
        ws.close();
        reject(new Error("websocket connect timeout"));
      }, 10_000);
      ws.addEventListener("open", () => {
        clearTimeout(openTimer);
        this.ws = ws;
        this.lastInbound = Date.now();
        this.attach(ws);
        this.startKeepalive();
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(openTimer);
        if (!this.ws) reject(new Error("websocket connect failed"));
      });
    }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private attach(ws: WebSocket): void {
    ws.addEventListener("message", (event) => {
      const raw =
        typeof event.data === "string" ? event.data : String(event.data);
      this.lastInbound = Date.now();
      if (byteLength(raw) > this.maxFrameBytes) {
        const err = new Error(
          `frame exceeds ${this.maxFrameBytes} byte ceiling; rejected with backpressure`,
        );
        for (const fn of this.frameErrors) fn(err, raw.slice(0, 256));
        // Fail any single pending waiter rather than hanging it; the
        // connection itself stays alive for subsequent frames.
        const first = this.pending.keys().next();
        if (!first.done) this.failPending(first.value, err);
        return;
      }
      let msg: ReturnType<typeof parseMessage>;
      try {
        msg = parseMessage(raw, this.maxFrameBytes);
      } catch (err) {
        for (const fn of this.frameErrors) fn(err as Error, raw.slice(0, 512));
        return;
      }
      if (msg.kind === "notification") {
        for (const fn of this.notifications) fn(msg.method, msg.params);
        return;
      }
      if (msg.kind === "response" || msg.kind === "error") {
        const slot = this.pending.get(msg.id);
        if (!slot) {
          for (const fn of this.frameErrors) {
            fn(
              new Error(`uncorrelated response id ${String(msg.id)}`),
              raw.slice(0, 256),
            );
          }
          return;
        }
        this.pending.delete(msg.id);
        clearTimeout(slot.timer);
        if (msg.kind === "response") slot.resolve(msg.result);
        else slot.reject(new Error(`RPC ${msg.code}: ${msg.message}`));
        return;
      }
      // Inbound requests from the editor are surfaced as notifications.
      if (msg.kind === "request") {
        for (const fn of this.notifications) fn(msg.method, msg.params);
      }
    });
    ws.addEventListener("close", () => {
      this.stopKeepalive();
      if (this.ws === ws) this.ws = null;
      const err = new Error("websocket closed with pending requests");
      for (const [id, slot] of this.pending) {
        clearTimeout(slot.timer);
        slot.reject(err);
        this.pending.delete(id);
      }
    });
  }

  private failPending(id: number | string, err: Error): void {
    const slot = this.pending.get(id);
    if (!slot) return;
    this.pending.delete(id);
    clearTimeout(slot.timer);
    slot.reject(err);
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.lastInbound = Date.now();
    this.pingTimer = setInterval(() => {
      const idle = Date.now() - this.lastInbound;
      if (idle > this.pongTimeoutMs) {
        const err = new Error(
          "bridge keepalive timeout (60s without inbound frame)",
        );
        for (const fn of this.frameErrors) fn(err, "");
        void this.close();
        return;
      }
      // Application-level ping; editor answers with any frame (pong or
      // notification), which refreshes lastInbound.
      try {
        this.ws?.send(JSON.stringify({ jsonrpc: "2.0", method: "ping" }));
      } catch {
        // send failures surface via close/error handlers.
      }
    }, this.pingIntervalMs);
    if (
      typeof (this.pingTimer as unknown as { unref?: () => void }).unref ===
      "function"
    ) {
      (this.pingTimer as unknown as { unref: () => void }).unref();
    }
  }

  private stopKeepalive(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  sendRequest(
    method: string,
    params?: unknown,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("bridge is not connected"));
    }
    const req = createRequest(method, params);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(req.id);
        reject(new Error(`request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(req.id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify(req));
      } catch (err) {
        this.pending.delete(req.id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }

  async close(): Promise<void> {
    this.stopKeepalive();
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    await new Promise<void>((resolve) => {
      try {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.addEventListener("close", () => resolve(), { once: true });
        ws.close();
        setTimeout(resolve, 1000);
      } catch {
        resolve();
      }
    });
  }
}
