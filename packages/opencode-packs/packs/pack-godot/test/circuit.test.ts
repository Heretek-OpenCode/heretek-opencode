import { describe, expect, test } from "bun:test";
import { CircuitBreaker } from "../src/session/circuit";

describe("CircuitBreaker", () => {
  test("trips after 5 consecutive failures", () => {
    const now = 1000;
    const cb = new CircuitBreaker({ timeFn: () => now });
    for (let i = 0; i < 4; i++) expect(cb.recordFailure("s")).toBe(false);
    expect(cb.checkOpen("s")).toBeNull();
    expect(cb.recordFailure("s")).toBe(true);
    const remaining = cb.checkOpen("s");
    expect(remaining).not.toBeNull();
    expect(remaining as number).toBeGreaterThan(0);
  });

  test("backoff doubles 1s..30s ceiling", () => {
    let now = 0;
    const cb = new CircuitBreaker({ timeFn: () => now });
    const windows: number[] = [];
    for (let i = 0; i < 5; i++) cb.recordFailure("s");
    windows.push(cb.checkOpen("s") as number);
    now += windows[0] / 1000 + 0.01;
    const expected = [2000, 4000, 8000, 16000, 30000, 30000];
    for (const want of expected) {
      cb.recordFailure("s");
      const remaining = cb.checkOpen("s") as number;
      windows.push(remaining);
      expect(remaining).toBe(want);
      now += remaining / 1000 + 0.01;
    }
    expect(windows[0]).toBe(1000);
    expect(windows.slice(5)).toEqual([30000, 30000]);
  });

  test("success resets the circuit", () => {
    const now = 0;
    const cb = new CircuitBreaker({ timeFn: () => now });
    for (let i = 0; i < 5; i++) cb.recordFailure("s");
    expect(cb.checkOpen("s")).not.toBeNull();
    cb.recordSuccess("s");
    expect(cb.checkOpen("s")).toBeNull();
    expect(cb.snapshot("s").consecutiveFailures).toBe(0);
  });

  test("half-open probe allowed after window elapses", () => {
    let now = 0;
    const cb = new CircuitBreaker({ timeFn: () => now });
    for (let i = 0; i < 5; i++) cb.recordFailure("s");
    expect(cb.isOpen("s")).toBe(true);
    now += 1.5;
    expect(cb.isOpen("s")).toBe(false);
    expect(cb.allowProbe("s")).toBe(true);
  });

  test("circuits are per-session isolated", () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 5; i++) cb.recordFailure("bad");
    expect(cb.checkOpen("bad")).not.toBeNull();
    expect(cb.checkOpen("good")).toBeNull();
  });
});
