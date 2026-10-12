// Per-session circuit breaker with exponential backoff.
// Trips after `threshold` consecutive failures; backoff starts at
// `initialOpenMs`, doubles per trip, capped at `maxOpenMs`. A successful
// call resets the circuit; an elapsed window permits a half-open probe.

export interface CircuitOptions {
  readonly threshold?: number;
  readonly initialOpenMs?: number;
  readonly maxOpenMs?: number;
  readonly timeFn?: () => number;
}

interface Entry {
  consecutiveFailures: number;
  openUntil: number;
  nextOpenMs: number;
  lastFailureKind: string;
}

export class CircuitBreaker {
  private readonly threshold: number;
  private readonly initialOpenMs: number;
  private readonly maxOpenMs: number;
  private readonly time: () => number;
  private readonly entries = new Map<string, Entry>();

  constructor(options: CircuitOptions = {}) {
    const threshold = options.threshold ?? 5;
    const initialOpenMs = options.initialOpenMs ?? 1000;
    const maxOpenMs = options.maxOpenMs ?? 30000;
    if (threshold < 1) throw new Error("threshold must be >= 1");
    if (initialOpenMs <= 0) throw new Error("initialOpenMs must be > 0");
    if (maxOpenMs < initialOpenMs)
      throw new Error("maxOpenMs must be >= initialOpenMs");
    this.threshold = threshold;
    this.initialOpenMs = initialOpenMs;
    this.maxOpenMs = maxOpenMs;
    this.time = options.timeFn ?? (() => Date.now() / 1000);
  }

  private entry(sessionId: string): Entry {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = {
        consecutiveFailures: 0,
        openUntil: 0,
        nextOpenMs: this.initialOpenMs,
        lastFailureKind: "",
      };
      this.entries.set(sessionId, entry);
    }
    return entry;
  }

  recordFailure(sessionId: string, kind = ""): boolean {
    const entry = this.entry(sessionId);
    entry.consecutiveFailures += 1;
    if (kind) entry.lastFailureKind = kind;
    if (entry.consecutiveFailures < this.threshold) return false;
    const now = this.time();
    const wasOpen = entry.openUntil > now;
    entry.openUntil = now + entry.nextOpenMs / 1000;
    entry.nextOpenMs = Math.min(entry.nextOpenMs * 2, this.maxOpenMs);
    return !wasOpen;
  }

  recordSuccess(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  checkOpen(sessionId: string): number | null {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.openUntil === 0) return null;
    const remainingMs = Math.round((entry.openUntil - this.time()) * 1000);
    if (remainingMs <= 0) return null;
    return remainingMs;
  }

  isOpen(sessionId: string): boolean {
    return this.checkOpen(sessionId) !== null;
  }

  // Half-open probe: allowed when no window is currently open. Callers
  // should attempt one request; success resets, failure re-opens escalated.
  allowProbe(sessionId: string): boolean {
    return !this.isOpen(sessionId);
  }

  snapshot(sessionId: string): {
    consecutiveFailures: number;
    circuitOpen: boolean;
    lastFailureKind?: string;
  } {
    const entry = this.entries.get(sessionId);
    if (!entry) return { consecutiveFailures: 0, circuitOpen: false };
    const snap: {
      consecutiveFailures: number;
      circuitOpen: boolean;
      lastFailureKind?: string;
    } = {
      consecutiveFailures: entry.consecutiveFailures,
      circuitOpen: entry.openUntil > this.time(),
    };
    if (entry.lastFailureKind) snap.lastFailureKind = entry.lastFailureKind;
    return snap;
  }
}
