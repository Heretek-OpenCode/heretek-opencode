import { describe, expect, test } from "bun:test";
import {
  GATE_IDS,
  aggregateGateVerdicts,
  formatGateVerdict,
  isGateId,
  parseGateVerdict,
  requireGate,
} from "../src/studio/gates";

describe("director gate protocol", () => {
  test("defines 26 deterministic gates including core set", () => {
    expect(GATE_IDS.length).toBe(26);
    for (const want of [
      "CD-PILLARS",
      "TD-ARCHITECTURE",
      "TD-FEASIBILITY",
      "QL-TEST-COVERAGE",
      "CD-PHASE-GATE",
      "TD-PHASE-GATE",
      "PR-PHASE-GATE",
      "LP-CODE-REVIEW",
    ]) {
      expect(GATE_IDS as unknown as string[]).toContain(want);
    }
    expect(new Set(GATE_IDS).size).toBe(26);
  });

  test("verdict line 1 format round-trips with criteria", () => {
    const out = formatGateVerdict("CD-PILLARS", "APPROVE", "pillars coherent");
    expect(out.split("\n")[0]).toBe("[CD-PILLARS]: APPROVE");
    const parsed = parseGateVerdict(out);
    expect(parsed.gateId).toBe("CD-PILLARS");
    expect(parsed.verdict).toBe("APPROVE");
  });

  test("all four verdict words parse", () => {
    for (const v of [
      "APPROVE",
      "CONCERNS",
      "REJECT",
      "NOT ASSESSED",
    ] as const) {
      const parsed = parseGateVerdict(`[TD-ARCHITECTURE]: ${v}\nrationale`);
      expect(parsed.verdict).toBe(v);
    }
  });

  test("malformed verdict rejected", () => {
    expect(() => parseGateVerdict("")).toThrow();
    expect(() => parseGateVerdict("no bracket here")).toThrow();
    expect(() => parseGateVerdict("[NOPE]: APPROVE")).toThrow();
    expect(() => parseGateVerdict("[CD-PILLARS]: MAYBE")).toThrow();
    expect(() => parseGateVerdict("[cd-pillars]: APPROVE")).toThrow();
    expect(() => parseGateVerdict("CD-PILLARS: APPROVE")).toThrow();
  });

  test("precedence REJECT > CONCERNS > NOT ASSESSED > APPROVE", () => {
    expect(aggregateGateVerdicts(["APPROVE", "APPROVE"])).toBe("APPROVE");
    expect(aggregateGateVerdicts(["APPROVE", "NOT ASSESSED"])).toBe(
      "NOT ASSESSED",
    );
    expect(aggregateGateVerdicts(["APPROVE", "CONCERNS", "NOT ASSESSED"])).toBe(
      "CONCERNS",
    );
    expect(
      aggregateGateVerdicts(["APPROVE", "CONCERNS", "REJECT", "NOT ASSESSED"]),
    ).toBe("REJECT");
    expect(aggregateGateVerdicts(["NOT ASSESSED", "NOT ASSESSED"])).toBe(
      "NOT ASSESSED",
    );
    expect(aggregateGateVerdicts(["CONCERNS", "CONCERNS"])).toBe("CONCERNS");
    expect(aggregateGateVerdicts([])).toBe("NOT ASSESSED");
  });

  test("gate guards reject unknown ids", () => {
    expect(isGateId("CD-PILLARS")).toBe(true);
    expect(isGateId("NOPE")).toBe(false);
    expect(() => requireGate("NOPE")).toThrow();
    expect(requireGate("TD-FEASIBILITY").id).toBe("TD-FEASIBILITY");
  });
});
