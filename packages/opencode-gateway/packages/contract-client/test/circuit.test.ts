import { describe, expect, test } from "bun:test";
import { HostCircuitBreaker, breakerKey } from "../src/circuit.js";

describe("circuit breaker transitions", () => {
  test("closed -> open after threshold, half-open probe recovers", () => {
    let t = 1_000;
    const b = new HostCircuitBreaker({ failureThreshold: 3, openMs: 5_000 }, () => t);
    expect(b.getState("example.com", "crawl4ai")).toBe("closed");
    b.recordFailure("example.com", "crawl4ai");
    b.recordFailure("example.com", "crawl4ai");
    expect(b.canExecute("example.com", "crawl4ai")).toBe(true);
    b.recordFailure("example.com", "crawl4ai");
    expect(b.getState("example.com", "crawl4ai")).toBe("open");
    expect(b.canExecute("example.com", "crawl4ai")).toBe(false);

    t += 5_000; // open window elapses -> half-open probe allowed
    expect(b.canExecute("example.com", "crawl4ai")).toBe(true);
    expect(b.getState("example.com", "crawl4ai")).toBe("half-open");
    b.recordSuccess("example.com", "crawl4ai");
    expect(b.getState("example.com", "crawl4ai")).toBe("closed");
    expect(b.canExecute("example.com", "crawl4ai")).toBe(true);
  });

  test("half-open probe failure re-opens", () => {
    let t = 0;
    const b = new HostCircuitBreaker({ failureThreshold: 1, openMs: 1_000 }, () => t);
    b.recordFailure("h.test", "searxng");
    expect(b.getState("h.test", "searxng")).toBe("open");
    t += 1_000;
    expect(b.canExecute("h.test", "searxng")).toBe(true);
    b.recordFailure("h.test", "searxng");
    expect(b.getState("h.test", "searxng")).toBe("open");
    expect(b.canExecute("h.test", "searxng")).toBe(false);
  });

  test("breakers are keyed by (host, engine): one host's outage spares others", () => {
    const b = new HostCircuitBreaker({ failureThreshold: 1, openMs: 60_000 });
    b.recordFailure("down.example", "crawl4ai");
    expect(b.getState("down.example", "crawl4ai")).toBe("open");
    // Same host, different engine: independent.
    expect(b.getState("down.example", "searxng")).toBe("closed");
    // Different host, same engine: independent.
    expect(b.getState("up.example", "crawl4ai")).toBe("closed");
    expect(breakerKey("Example.COM.", "CRAWL4AI")).toBe(breakerKey("example.com", "crawl4ai"));
  });

  test("success resets the consecutive-failure count", () => {
    const b = new HostCircuitBreaker({ failureThreshold: 3 });
    b.recordFailure("h", "e");
    b.recordFailure("h", "e");
    b.recordSuccess("h", "e");
    b.recordFailure("h", "e");
    b.recordFailure("h", "e");
    expect(b.getState("h", "e")).toBe("closed");
  });
});
