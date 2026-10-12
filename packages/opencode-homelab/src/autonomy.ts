import { z } from "zod";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AutonomyModeSchema = z.enum(["advisory", "balanced", "full"]);
export type AutonomyMode = z.infer<typeof AutonomyModeSchema>;

const AutonomyFileSchema = z.object({
  version: z.literal(1),
  mode: AutonomyModeSchema,
});

export type AutonomyConfig = z.infer<typeof AutonomyFileSchema>;

/** Ordered pipeline stages the dial gates. */
export const STAGES = [
  "grill",
  "research",
  "spec",
  "build",
  "qa",
  "human_pr",
] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Parse and validate an autonomy config file (default: ./config/autonomy.json).
 * Throws on missing file, bad JSON, or schema violation (fail closed).
 */
export function parseAutonomyConfig(path?: string): AutonomyConfig {
  const file = path ?? resolve(dirname(fileURLToPath(import.meta.url)), "../config/autonomy.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new Error(`autonomy config unreadable at ${file}: ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`autonomy config invalid JSON at ${file}: ${(err as Error).message}`);
  }
  return AutonomyFileSchema.parse(json);
}

/**
 * Gate: does `mode` require a human stop before proceeding past `stage`?
 *
 * - advisory: stops at EVERY stage (including research/build/qa).
 * - balanced: stops only at spec and at the human PR gate.
 * - full:     stops only at the human PR gate (merge is always human-only).
 */
export function requiresStop(mode: AutonomyMode, stage: Stage): boolean {
  AutonomyModeSchema.parse(mode);
  if (!STAGES.includes(stage)) throw new Error(`unknown stage: ${stage}`);
  switch (mode) {
    case "advisory":
      return true;
    case "balanced":
      return stage === "spec" || stage === "human_pr";
    case "full":
      return stage === "human_pr";
  }
}

/** Stages in `STAGES` order where `mode` stops. */
export function stopsFor(mode: AutonomyMode): Stage[] {
  return STAGES.filter((s) => requiresStop(mode, s));
}
