import { describe, expect, test } from "bun:test";
import { grillMission, buildAcceptanceCriteria, renderMissionBrief, finalizeMission } from "../src/director/index.js";
import type { MissionBrief } from "../src/director/index.js";

describe("grillMission", () => {
  test("short intent yields a blocking question", () => {
    const qs = grillMission("hi");
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.some((q) => q.severity === "blocking")).toBe(true);
  });

  test("detailed intent yields no blocking questions", () => {
    const qs = grillMission(
      "Build a CSV export for the billing dashboard. It must stream rows for large accounts. Done when the export downloads under 5s for 100k rows.",
    );
    expect(qs.filter((q) => q.severity === "blocking")).toEqual([]);
  });
});

describe("finalizeMission", () => {
  const base: MissionBrief = {
    title: "csv export",
    intent: "Build a CSV export for the billing dashboard.",
    acceptance: [{ id: "ac-1", text: "export downloads", verify: "judge" }],
    openQuestions: [],
  };

  test("ok=false with a blocking question open", () => {
    const brief: MissionBrief = {
      ...base,
      openQuestions: [{ id: "q-vague", question: "what exactly?", severity: "blocking" }],
    };
    const r = finalizeMission(brief);
    expect(r.ok).toBe(false);
    expect(r.blocking.length).toBe(1);
  });

  test("ok=true once only minor questions remain", () => {
    const brief: MissionBrief = {
      ...base,
      openQuestions: [{ id: "q-scope", question: "scope detail?", severity: "minor" }],
    };
    expect(finalizeMission(brief).ok).toBe(true);
    expect(finalizeMission({ ...base }).ok).toBe(true);
  });
});

describe("renderMissionBrief", () => {
  test("contains the title and acceptance lines", () => {
    const brief: MissionBrief = {
      title: "csv export",
      intent: "Build a CSV export for the billing dashboard.",
      acceptance: buildAcceptanceCriteria("Build a CSV export. It must stream rows."),
      openQuestions: [],
    };
    const md = renderMissionBrief(brief);
    expect(md).toContain("# csv export");
    for (const ac of brief.acceptance) expect(md).toContain(ac.text);
  });
});
