import type { Task } from "../state/types.js";

/**
 * Lane tiers: throwaway execution environments matched to risk.
 *  - bwrap: bubblewrap sandbox, trusted-local single-repo tasks (~ms startup)
 *  - docker: rootless container, default for clean-env / pack runtimes (~s)
 *  - dagger: hermetic reproducible builds, parallel fleets, CI parity (~s)
 */

export type LaneTier = Task["lane"];

export interface LaneRequest {
  /** Needs a clean environment or a pack runtime (godot, gdevelop, ...). */
  readonly needsCleanEnv?: boolean;
  /** Pack capability required (maps to a lane image). */
  readonly capability?: string;
  /** Needs hermetic, content-addressed, reproducible execution. */
  readonly hermetic?: boolean;
  /** Runs alongside other tasks; favors hermetic isolation. */
  readonly parallel?: boolean;
  /** Explicit operator override. */
  readonly force?: LaneTier;
}

export interface LaneSelection {
  readonly tier: LaneTier;
  readonly image?: string;
  readonly network: "none" | "gateway-only";
  readonly reason: string;
}

export const LANE_IMAGES: Record<string, string> = {
  base: "lane-base:latest",
  godot: "lane-godot:4.x",
  gdevelop: "lane-gdevelop:latest",
  rea: "lane-rea:latest",
};

export function laneImageFor(capability?: string): string {
  if (capability && LANE_IMAGES[capability]) return LANE_IMAGES[capability]!;
  return LANE_IMAGES["base"]!;
}

/** Map expert access class to a default lane: ro -> bwrap, scoped -> docker. */
export function tierForExpert(access: "ro" | "scoped", capability?: string): LaneSelection {
  if (access === "ro" && !capability) return selectTier({});
  return selectTier({ needsCleanEnv: true, capability });
}
/** Pick the cheapest tier that satisfies the request. */
export function selectTier(req: LaneRequest): LaneSelection {
  if (req.force) {
    return {
      tier: req.force,
      image: req.force === "bwrap" ? undefined : laneImageFor(req.capability),
      network: "none",
      reason: `operator override to ${req.force}`,
    };
  }
  if (req.hermetic || req.parallel) {
    return {
      tier: "dagger",
      image: laneImageFor(req.capability),
      network: "none",
      reason: "hermetic or parallel execution needs content-addressed isolation",
    };
  }
  if (req.needsCleanEnv || req.capability) {
    return {
      tier: "docker",
      image: laneImageFor(req.capability),
      network: "gateway-only",
      reason: req.capability ? `pack capability ${JSON.stringify(req.capability)}` : "clean environment requested",
    };
  }
  return { tier: "bwrap", network: "none", reason: "trusted-local task, no special runtime" };
}
