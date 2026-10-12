import { describe, expect, test } from "bun:test";
import { findCycle, readySet, topoSort, validateDag, DagError } from "../src/dag/index.js";
import { makeTask } from "../src/state/index.js";
import type { Task } from "../src/state/index.js";

function tasks(specs: Array<{ id: string; deps?: string[]; state?: Task["state"] }>): Task[] {
  return specs.map((s) =>
    makeTask({ id: s.id, missionId: "m-1", deps: s.deps ?? [], state: s.state ?? "pending" }),
  );
}

describe("validateDag", () => {
  test("accepts a valid diamond", () => {
    expect(() =>
      validateDag(tasks([{ id: "a" }, { id: "b", deps: ["a"] }, { id: "c", deps: ["a"] }, { id: "d", deps: ["b", "c"] }])),
    ).not.toThrow();
  });

  test("rejects unknown deps", () => {
    expect(() => validateDag(tasks([{ id: "a", deps: ["ghost"] }]))).toThrow(DagError);
  });

  test("rejects self-deps", () => {
    expect(() => validateDag(tasks([{ id: "a", deps: ["a"] }]))).toThrow(DagError);
  });

  test("rejects cycles", () => {
    expect(() => validateDag(tasks([{ id: "a", deps: ["c"] }, { id: "b", deps: ["a"] }, { id: "c", deps: ["b"] }]))).toThrow(
      /cycle/,
    );
  });
});

describe("findCycle", () => {
  test("returns null for acyclic graphs", () => {
    expect(findCycle(tasks([{ id: "a" }, { id: "b", deps: ["a"] }]))).toBeNull();
  });

  test("returns the cycle path", () => {
    const cycle = findCycle(tasks([{ id: "a", deps: ["b"] }, { id: "b", deps: ["a"] }]));
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    expect(new Set(cycle!).has("a") && new Set(cycle!).has("b")).toBe(true);
  });
});

describe("topoSort", () => {
  test("orders deps before dependents", () => {
    const order = topoSort(
      tasks([{ id: "d", deps: ["b", "c"] }, { id: "c", deps: ["a"] }, { id: "b", deps: ["a"] }, { id: "a" }]),
    ).map((t) => t.id);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("d"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("d"));
  });

  test("is deterministic", () => {
    const specs = [{ id: "c" }, { id: "a" }, { id: "b" }];
    const once = topoSort(tasks(specs)).map((t) => t.id);
    const twice = topoSort(tasks(specs)).map((t) => t.id);
    expect(once).toEqual(twice);
    expect(once).toEqual(["a", "b", "c"]);
  });
});

describe("readySet", () => {
  test("only tasks with all deps done are ready", () => {
    const list = tasks([
      { id: "a", state: "done" },
      { id: "b", deps: ["a"] },
      { id: "c", deps: ["b"] },
      { id: "d", state: "done" },
    ]);
    expect(readySet(list).map((t) => t.id)).toEqual(["b"]);
  });

  test("excludes running and terminal tasks", () => {
    const list = tasks([
      { id: "a", state: "running" },
      { id: "b", state: "done" },
      { id: "c", state: "failed" },
      { id: "d" },
    ]);
    expect(readySet(list).map((t) => t.id)).toEqual(["d"]);
  });

  test("waiting_human blocks dependents", () => {
    const list = tasks([{ id: "a", state: "waiting_human" }, { id: "b", deps: ["a"] }]);
    expect(readySet(list)).toEqual([]);
  });
});
