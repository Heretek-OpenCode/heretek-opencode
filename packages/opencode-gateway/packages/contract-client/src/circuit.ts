/** Breaker states: closed (traffic flows), open (fail fast), half-open (probing). */
export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  /** Consecutive failures that trip closed -> open. Default 5. */
  failureThreshold?: number;
  /** ms an open breaker waits before allowing a half-open probe. Default 30_000. */
  openMs?: number;
  /** Max concurrent half-open probes per key. Default 1. */
  halfOpenMaxCalls?: number;
}

interface BreakerEntry {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number;
  halfOpenInFlight: number;
}

export function breakerKey(host: string, engine: string): string {
  return `${host.toLowerCase().replace(/\.+$/, "")}\x00${engine.toLowerCase()}`;
}

/**
 * Per-host circuit breaker keyed by (host, engine): one host's 403 must not
 * cool every host. Transitions:
 * closed --(threshold consecutive failures)--> open --(openMs)--> half-open
 * --(probe success)--> closed, --(probe failure)--> open.
 */
export class HostCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly halfOpenMaxCalls: number;
  private readonly entries = new Map<string, BreakerEntry>();
  private now: () => number;

  constructor(opts: BreakerOptions = {}, clock?: () => number) {
    this.failureThreshold = Math.max(1, opts.failureThreshold ?? 5);
    this.openMs = Math.max(0, opts.openMs ?? 30_000);
    this.halfOpenMaxCalls = Math.max(1, opts.halfOpenMaxCalls ?? 1);
    this.now = clock ?? (() => Date.now());
  }

  /** Test seam: swap the clock. */
  setClock(clock: () => number): void {
    this.now = clock;
  }

  private entry(key: string): BreakerEntry {
    let e = this.entries.get(key);
    if (!e) {
      e = { state: "closed", consecutiveFailures: 0, openedAt: 0, halfOpenInFlight: 0 };
      this.entries.set(key, e);
    }
    return e;
  }

  getState(host: string, engine: string): BreakerState {
    const e = this.entry(breakerKey(host, engine));
    if (e.state === "open" && this.now() - e.openedAt >= this.openMs) {
      e.state = "half-open";
      e.halfOpenInFlight = 0;
    }
    return e.state;
  }

  /** False when the call must fail fast (open, or half-open probe slots full). */
  canExecute(host: string, engine: string): boolean {
    const e = this.entry(breakerKey(host, engine));
    if (e.state === "open") {
      if (this.now() - e.openedAt >= this.openMs) {
        e.state = "half-open";
        e.halfOpenInFlight = 0;
      } else {
        return false;
      }
    }
    if (e.state === "half-open") {
      if (e.halfOpenInFlight >= this.halfOpenMaxCalls) return false;
      e.halfOpenInFlight += 1;
      return true;
    }
    return true;
  }

  recordSuccess(host: string, engine: string): void {
    const e = this.entry(breakerKey(host, engine));
    if (e.state === "half-open") e.halfOpenInFlight = Math.max(0, e.halfOpenInFlight - 1);
    e.state = "closed";
    e.consecutiveFailures = 0;
  }

  recordFailure(host: string, engine: string): void {
    const e = this.entry(breakerKey(host, engine));
    if (e.state === "half-open") {
      e.halfOpenInFlight = Math.max(0, e.halfOpenInFlight - 1);
      e.state = "open";
      e.openedAt = this.now();
      return;
    }
    e.consecutiveFailures += 1;
    if (e.consecutiveFailures >= this.failureThreshold) {
      e.state = "open";
      e.openedAt = this.now();
    }
  }

  /** Introspection for /ready + tests. */
  snapshot(): Record<string, { state: BreakerState; consecutiveFailures: number }> {
    const out: Record<string, { state: BreakerState; consecutiveFailures: number }> = {};
    for (const [k, e] of this.entries) out[k] = { state: e.state, consecutiveFailures: e.consecutiveFailures };
    return out;
  }

  reset(): void {
    this.entries.clear();
  }
}
