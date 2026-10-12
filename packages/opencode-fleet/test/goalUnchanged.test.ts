import { describe, expect, test } from "bun:test";
import { checkGoalDrift, goalUnchanged } from "../src/scheduler/index.js";
import type { GoalSnapshot } from "../src/scheduler/index.js";

const INITIAL: GoalSnapshot = {
  intent: "Add CSV export to the reports page with a download button",
  criteria: [
    { id: "c1", text: "Export button downloads a valid CSV file", verify: "cmd" },
    { id: "c2", text: "Export respects the current date filter", verify: "judge" },
  ],
};

describe("goalUnchanged", () => {
  test("identical context is unchanged", () => {
    expect(goalUnchanged(INITIAL, structuredClone(INITIAL))).toBe(true);
  });

  test("cosmetic rewording is unchanged", () => {
    const current: GoalSnapshot = {
      intent: "Add a CSV export to reports page, with download button!",
      criteria: [
        { id: "c1", text: "Export button downloads a valid CSV file.", verify: "cmd" },
        { id: "c2", text: "Export respects the current date filter", verify: "judge" },
      ],
    };
    expect(goalUnchanged(INITIAL, current)).toBe(true);
  });

  test("mutated intent is drift", () => {
    const current: GoalSnapshot = {
      intent: "Rewrite the billing system in Rust",
      criteria: INITIAL.criteria,
    };
    expect(goalUnchanged(INITIAL, current)).toBe(false);
    expect(checkGoalDrift(INITIAL, current).reasons.some((r) => r.includes("intent"))).toBe(true);
  });

  test("dropped criterion is drift", () => {
    const current: GoalSnapshot = { intent: INITIAL.intent, criteria: [INITIAL.criteria[0]!] };
    expect(goalUnchanged(INITIAL, current)).toBe(false);
  });

  test("weakened verify method is drift", () => {
    const current: GoalSnapshot = {
      intent: INITIAL.intent,
      criteria: [
        { id: "c1", text: "Export button downloads a valid CSV file", verify: "human" },
        INITIAL.criteria[1]!,
      ],
    };
    const report = checkGoalDrift(INITIAL, current);
    expect(report.unchanged).toBe(false);
    expect(report.reasons.some((r) => r.includes("weakened"))).toBe(true);
  });

  test("added scope without a grill round is drift", () => {
    const current: GoalSnapshot = {
      intent: INITIAL.intent,
      criteria: [...INITIAL.criteria, { id: "c9", text: "Also send exports by email nightly", verify: "cmd" }],
    };
    expect(goalUnchanged(INITIAL, current)).toBe(false);
  });
});
