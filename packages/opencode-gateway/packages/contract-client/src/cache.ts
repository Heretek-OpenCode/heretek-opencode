import { createHash } from "node:crypto";
import type { ToolName } from "./schemas.js";
import { CONTRACT_VERSION } from "./schemas.js";

/** TTL per tool class. Search is volatile; research reports are stable. */
export const CACHE_TTLS_MS: Record<ToolName, number> = {
  search: 5 * 60 * 1000,
  fetch: 60 * 60 * 1000,
  extract_structured: 60 * 60 * 1000,
  research_report: 24 * 60 * 60 * 1000,
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/** Cache key = sha256(tool + params + contractVersion). Key order is normalized. */
export function cacheKeyFor(tool: ToolName, params: unknown, contractVersion: number = CONTRACT_VERSION): string {
  return createHash("sha256").update(`${tool}\x00${stableStringify(params)}\x00${contractVersion}`, "utf8").digest("hex");
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  fetchedAt: string;
}

/** Minimal TTL cache. Hits return provenance with `cached: true` upstream. */
export class MemoryCache<T = unknown> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private now: () => number;

  constructor(clock?: () => number) {
    this.now = clock ?? (() => Date.now());
  }

  setClock(clock: () => number): void {
    this.now = clock;
  }

  set(key: string, value: T, ttlMs: number, fetchedAt?: string): void {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs, fetchedAt: fetchedAt ?? new Date().toISOString() });
  }

  get(key: string): { value: T; fetchedAt: string } | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (this.now() >= e.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return { value: e.value, fetchedAt: e.fetchedAt };
  }

  size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
