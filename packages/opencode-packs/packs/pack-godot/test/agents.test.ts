import { describe, expect, test } from "bun:test";
import {
  STUDIO_AGENTS,
  checkStudioPermission,
  getStudioAgent,
  isStudioAgentId,
  registerStudioAgents,
  requireStudioAgent,
  studioAgentTransform,
} from "../src/studio/agents";

function mockEditor() {
  const store = new Map<string, unknown>();
  return {
    added: [] as string[],
    list: () => [...store.values()] as never[],
    get: (id: string) => store.get(id) as never | undefined,
    default: (_id: string | undefined) => undefined,
    update: (_id: string, _fn: (a: never) => void) => undefined,
    remove: (id: string) => {
      store.delete(id);
    },
    add: (def: { id: string }) => {
      store.set(def.id, def);
    },
    get store() {
      return store;
    },
  };
}

describe("studio agent roster", () => {
  test("defines 10 agents across 3 tiers", () => {
    expect(STUDIO_AGENTS.length).toBe(10);
    const ids = STUDIO_AGENTS.map((a) => a.id);
    for (const want of [
      "technical-director",
      "creative-director",
      "producer",
      "lead-programmer",
      "game-designer",
      "qa-lead",
      "godot-architect",
      "godot-gdscript-specialist",
      "godot-shader-specialist",
      "godot-qa-tester",
    ]) {
      expect(ids).toContain(want);
    }
  });

  test("directors use pro/opus models with deny/deny permissions", () => {
    for (const id of ["technical-director", "creative-director", "producer"]) {
      const def = requireStudioAgent(id);
      expect(def.tier).toBe("director");
      expect(["pro", "opus"]).toContain(def.model);
      expect(def.permissions.shell).toBe("deny");
      expect(def.permissions.edit).toBe("deny");
    }
  });

  test("leads use shell:deny edit:ask", () => {
    for (const id of ["lead-programmer", "game-designer", "qa-lead"]) {
      const def = requireStudioAgent(id);
      expect(def.tier).toBe("lead");
      expect(def.permissions.shell).toBe("deny");
      expect(def.permissions.edit).toBe("ask");
    }
  });

  test("specialists use shell:allow edit:allow", () => {
    for (const id of [
      "godot-architect",
      "godot-gdscript-specialist",
      "godot-shader-specialist",
      "godot-qa-tester",
    ]) {
      const def = requireStudioAgent(id);
      expect(def.tier).toBe("specialist");
      expect(def.permissions.shell).toBe("allow");
      expect(def.permissions.edit).toBe("allow");
    }
  });

  test("permission matrix enforced via checkStudioPermission", () => {
    expect(checkStudioPermission("technical-director", "shell")).toBe("deny");
    expect(checkStudioPermission("technical-director", "edit")).toBe("deny");
    expect(checkStudioPermission("lead-programmer", "shell")).toBe("deny");
    expect(checkStudioPermission("lead-programmer", "edit")).toBe("ask");
    expect(checkStudioPermission("godot-gdscript-specialist", "shell")).toBe(
      "allow",
    );
    expect(checkStudioPermission("godot-gdscript-specialist", "edit")).toBe(
      "allow",
    );
  });

  test("unknown agent rejected", () => {
    expect(isStudioAgentId("nope")).toBe(false);
    expect(isStudioAgentId("technical-director")).toBe(true);
    expect(getStudioAgent("nope")).toBeUndefined();
    expect(() => requireStudioAgent("nope")).toThrow();
    expect(() => checkStudioPermission("nope", "shell")).toThrow();
  });

  test("transform-compatible registration populates editor", () => {
    const editor = mockEditor();
    studioAgentTransform(editor as never);
    for (const def of STUDIO_AGENTS) {
      expect(editor.store.has(def.id)).toBe(true);
    }
    const editor2 = mockEditor();
    registerStudioAgents(editor2 as never);
    expect(editor2.store.size).toBe(10);
  });
});
