import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGES,
  parseAutonomyConfig,
  requiresStop,
  stopsFor,
} from "../src/autonomy";

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), "../config/autonomy.json");

describe("autonomy dial (STC #8)", () => {
  test("ships a valid default config (balanced)", () => {
    const cfg = parseAutonomyConfig(CONFIG);
    expect(cfg.version).toBe(1);
    expect(cfg.mode).toBe("balanced");
  });

  test("advisory stops at every stage", () => {
    expect(stopsFor("advisory")).toEqual([...STAGES]);
    for (const s of STAGES) expect(requiresStop("advisory", s)).toBe(true);
  });

  test("balanced stops only at spec + PR", () => {
    expect(stopsFor("balanced")).toEqual(["spec", "human_pr"]);
    expect(requiresStop("balanced", "spec")).toBe(true);
    expect(requiresStop("balanced", "human_pr")).toBe(true);
    expect(requiresStop("balanced", "grill")).toBe(false);
    expect(requiresStop("balanced", "research")).toBe(false);
    expect(requiresStop("balanced", "build")).toBe(false);
    expect(requiresStop("balanced", "qa")).toBe(false);
  });

  test("full stops only at PR (merge always human)", () => {
    expect(stopsFor("full")).toEqual(["human_pr"]);
    expect(requiresStop("full", "human_pr")).toBe(true);
    expect(requiresStop("full", "spec")).toBe(false);
    expect(requiresStop("full", "build")).toBe(false);
  });

  test("fails closed on unknown mode / stage", () => {
    // @ts-expect-error intentional misuse
    expect(() => requiresStop("turbo", "build")).toThrow();
    // @ts-expect-error intentional misuse
    expect(() => requiresStop("full", "deploy")).toThrow();
  });

  test("fails closed on missing config file", () => {
    expect(() => parseAutonomyConfig(join(dirname(fileURLToPath(import.meta.url)), "nope.json"))).toThrow();
  });
});
