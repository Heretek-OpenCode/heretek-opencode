import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGates } from "../src/gates/runner.js";
import { GateReportSchema } from "../src/contracts.js";

function writeConfig(name: string, text: string): string {
  const dir: string = mkdtempSync(join(tmpdir(), "gates-"));
  const path: string = join(dir, name);
  writeFileSync(path, text);
  return path;
}

describe("gate runner", () => {
  test("passing gates produce a valid GateReport", async () => {
    const cfg: string = writeConfig("gates.yaml", "version: 1\ngates:\n  - id: lint\n    kind: lint\n    cmd: \"echo ok\"\n");
    const report = await runGates(cfg, { taskId: "t-1", commit: "abc", diffLines: 10 });
    expect(() => GateReportSchema.parse(report)).not.toThrow();
    expect(report.verdict).toBe("pass");
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.outputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("failing command yields fail verdict", async () => {
    const cfg: string = writeConfig("gates.yaml", "version: 1\ngates:\n  - id: bad\n    kind: custom\n    cmd: \"exit 3\"\n");
    const report = await runGates(cfg, { taskId: "t-2", commit: "abc" });
    expect(report.verdict).toBe("fail");
    expect(report.checks[0]?.exit).toBe(3);
    expect(() => GateReportSchema.parse(report)).not.toThrow();
  });

  test("budget gate enforces maxDiffLines", async () => {
    const cfg: string = writeConfig(
      "gates.yaml",
      "version: 1\ngates:\n  - id: lint\n    kind: lint\n    cmd: \"echo ok\"\n  - id: budget\n    kind: budget\n    maxDiffLines: 100\n",
    );
    const over = await runGates(cfg, { taskId: "t-3", commit: "abc", diffLines: 500 });
    expect(over.verdict).toBe("fail");
    expect(over.budget).toEqual({ diffLines: 500, limit: 100 });
    const under = await runGates(cfg, { taskId: "t-3", commit: "abc", diffLines: 50 });
    expect(under.verdict).toBe("pass");
  });

  test("timeout is a first-class outcome (exit 124, timedOut)", async () => {
    const cfg: string = writeConfig(
      "gates.yaml",
      "version: 1\ngates:\n  - id: slow\n    kind: custom\n    cmd: \"sleep 30\"\n    timeoutSeconds: 1\n",
    );
    const report = await runGates(cfg, { taskId: "t-4", commit: "abc" });
    expect(report.checks[0]?.timedOut).toBe(true);
    expect(report.checks[0]?.exit).toBe(124);
    expect(report.verdict).toBe("timeout");
    expect(() => GateReportSchema.parse(report)).not.toThrow();
  }, 15000);
});
