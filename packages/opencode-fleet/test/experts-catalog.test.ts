import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CORE_EXPERTS, EXPERT_CATALOG, getExpert } from "../src/experts/index.js";

const EXPECTED_KEYS = [
  "director",
  "scout",
  "architect",
  "product",
  "frontend",
  "backend",
  "dba",
  "platform",
  "security",
  "qa",
  "reviewer",
  "docs",
];

describe("expert catalog", () => {
  test("has exactly the 12 core keys", () => {
    expect(Object.keys(EXPERT_CATALOG).sort()).toEqual([...EXPECTED_KEYS].sort());
    expect([...CORE_EXPERTS].sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  test("each expert has non-empty systemPrompt/handles/skills and a valid access class", () => {
    for (const key of EXPECTED_KEYS) {
      const e = EXPERT_CATALOG[key]!;
      expect(e.name).toBe(key);
      expect(e.profile).toBe("core");
      expect(e.systemPrompt.trim().length).toBeGreaterThan(50);
      expect(e.handles.length).toBeGreaterThan(0);
      expect(e.skills.length).toBeGreaterThan(0);
      expect(Array.isArray(e.writeGlobs)).toBe(true);
      // ro experts write nothing (reports go to /artifacts); scoped experts own globs.
      if (e.access === "ro") expect(e.writeGlobs).toEqual([]);
      else expect(e.writeGlobs.length).toBeGreaterThan(0);
    }
  });

  test("getExpert returns entries and throws on unknown", () => {
    expect(getExpert("qa").name).toBe("qa");
    expect(() => getExpert("nope")).toThrow(/unknown expert/);
  });

  test("fleet.yaml names match the catalog", () => {
    const text = readFileSync(new URL("../src/fleet.yaml", import.meta.url), "utf8");
    // Minimal line parser: fleet.yaml only uses `- name: <expert>` list items.
    const names = [...text.matchAll(/^\s*-\s*name:\s*(\S+)\s*$/gm)].map((m) => m[1]!);
    expect(names.sort()).toEqual([...EXPECTED_KEYS].sort());
  });
});
