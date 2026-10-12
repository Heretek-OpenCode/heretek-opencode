import { describe, expect, test } from "bun:test";
import {
  DEV_STORY_STEPS,
  STORY_DONE_PHASES,
  STUDIO_COMMANDS,
  executeStudioCommand,
  isStudioCommandName,
  registerStudioCommands,
  runDevStory,
  runGateCheck,
  runStoryDone,
} from "../src/studio/commands";

function mockCommandEditor() {
  const defs = new Map<string, { name: string; execute: unknown }>();
  return {
    defs,
    add: (def: { name: string; execute: unknown }) => {
      defs.set(def.name, def);
    },
  };
}

describe("studio slash commands", () => {
  test("defines 5 commands", () => {
    const names = STUDIO_COMMANDS.map((c) => c.name);
    expect(names).toContain("setup-godot");
    expect(names).toContain("adr");
    expect(names).toContain("dev-story");
    expect(names).toContain("story-done");
    expect(names).toContain("gate-check");
    expect(STUDIO_COMMANDS.length).toBe(5);
  });

  test("each command executes against mocks", async () => {
    const ok = await executeStudioCommand(
      "setup-godot",
      { args: [] },
      { checkEngine: async () => ({ ok: true as boolean, version: "4.3" }) },
    );
    expect(ok.ok).toBe(true);

    const adr = await executeStudioCommand("adr", { args: ["decide-x"] }, {});
    expect(adr.ok).toBe(true);

    const dev = await runDevStory(
      { storyId: "S-1" },
      {
        loadStory: async () => ({ id: "S-1", title: "t" }),
        spawnSpecialist: async () => ({ files: ["a.gd"] }),
        runGut: async () => ({ passed: true }),
        runHeadlessCheck: async () => ({ passed: true }),
        commit: async () => ({ sha: "abc" }),
      },
    );
    expect(dev.ok).toBe(true);
    expect(dev.steps.map((s) => s.step)).toEqual([...DEV_STORY_STEPS]);

    const done = await runStoryDone(
      { storyId: "S-1" },
      {
        runPhase: async (phase: string) => ({ phase, passed: true }),
      },
    );
    expect(done.ok).toBe(true);
    expect(done.phases.map((p) => p.phase)).toEqual([...STORY_DONE_PHASES]);
    expect(STORY_DONE_PHASES.length).toBe(8);

    const gate = await runGateCheck(
      {},
      { runGates: async () => ["[CD-PILLARS]: APPROVE\nok"] },
    );
    expect(gate.ok).toBe(true);
    expect(gate.verdict).toBe("APPROVE");
  });

  test("dev-story aborts on failing step", async () => {
    const dev = await runDevStory(
      { storyId: "S-2" },
      {
        loadStory: async () => ({ id: "S-2" }),
        spawnSpecialist: async () => ({}),
        runGut: async () => ({ passed: false, failures: ["t1"] }),
        runHeadlessCheck: async () => ({ passed: true }),
        commit: async () => ({ sha: "x" }),
      },
    );
    expect(dev.ok).toBe(false);
  });

  test("gate-check aggregates worst verdict", async () => {
    const gate = await runGateCheck(
      {},
      {
        runGates: async () => [
          "[CD-PILLARS]: APPROVE\nok",
          "[TD-ARCHITECTURE]: CONCERNS\nneeds work",
        ],
      },
    );
    expect(gate.verdict).toBe("CONCERNS");
    expect(gate.ok).toBe(true);
    const rejected = await runGateCheck(
      {},
      { runGates: async () => ["[TD-ARCHITECTURE]: REJECT\nblocked"] },
    );
    expect(rejected.verdict).toBe("REJECT");
    expect(rejected.ok).toBe(false);
  });

  test("unknown command rejected", async () => {
    expect(isStudioCommandName("setup-godot")).toBe(true);
    expect(isStudioCommandName("nope")).toBe(false);
    await expect(executeStudioCommand("nope", {}, {})).rejects.toThrow();
  });

  test("transform-compatible registration", async () => {
    const editor = mockCommandEditor();
    registerStudioCommands(editor as never);
    expect(editor.defs.size).toBe(5);
    for (const c of STUDIO_COMMANDS) expect(editor.defs.has(c.name)).toBe(true);
  });
});
