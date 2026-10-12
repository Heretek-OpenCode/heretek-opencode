import { accessSync, constants as fsConstants } from "node:fs";
import { join } from "node:path";
import {
  definePack,
  hostSatisfiesCompat,
  type ReadyResult,
} from "../../../packages/pack-sdk/src/index";
import { GODOT_TOOLS } from "./tools";

export const PACK_ID = "godot";
export const PACK_VERSION = "1.0.0";
export const HOST_COMPAT = "2.0.x";
export const GODOT_BRIDGE_PORT = 9500;
export const GODOT_BRIDGE_HOST = "127.0.0.1";

export interface GodotReadyOptions {
  /** Override the godot-binary probe (tests inject true/false here). */
  probeGodot?: () => boolean | Promise<boolean>;
}

/** True when a `godot` binary is resolvable (Bun.which, falling back to a PATH scan). */
export function defaultGodotProbe(): boolean {
  const bunWhich = (globalThis as { Bun?: { which?: (cmd: string) => string | null } }).Bun?.which;
  if (typeof bunWhich === "function") {
    try {
      if (bunWhich("godot") !== null) return true;
    } catch {
      /* fall through to PATH scan */
    }
  }
  const delimiter = process.platform === "win32" ? ";" : ":";
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const suffix of suffixes) {
      try {
        accessSync(join(dir, `godot${suffix}`), fsConstants.X_OK);
        return true;
      } catch {
        /* keep scanning */
      }
    }
  }
  return false;
}

export async function ready(
  hostVersion: string,
  opts: GodotReadyOptions = {},
): Promise<ReadyResult> {
  if (!hostSatisfiesCompat(HOST_COMPAT, hostVersion)) {
    return {
      status: "degraded",
      reason: `pack-godot ${PACK_VERSION} requires host ${HOST_COMPAT}, got ${hostVersion}`,
    };
  }
  const probe = opts.probeGodot ?? defaultGodotProbe;
  if (!(await probe())) {
    return {
      status: "degraded",
      reason:
        "godot binary not found on PATH; install a Godot 4.x headless editor build or run inside the lane-godot image",
    };
  }
  return { status: "ready" };
}

export const manifest = definePack({
  id: PACK_ID,
  version: PACK_VERSION,
  hostCompat: HOST_COMPAT,
  laneRequires: [{ capability: "godot", image: "ghcr.io/heretek-opencode/lane-godot:4.x" }],
  tools: [{ server: "./mcp/godot.js", transport: "stdio" }],
  skills: ["./skills/godot-scene.md"],
  commands: [{ name: "godot.open-scene", handler: "tools.godotOpenScene" }],
  hooks: { toolGuard: "./src/guard.ts" },
  ready,
});

export { GODOT_TOOLS };
export default manifest;
