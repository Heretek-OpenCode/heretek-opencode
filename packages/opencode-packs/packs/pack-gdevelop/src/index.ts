import {
  definePack,
  hostSatisfiesCompat,
  type ReadyResult,
} from "../../../packages/pack-sdk/src/index";

export const PACK_ID = "gdevelop";
export const PACK_VERSION = "1.0.0";
export const HOST_COMPAT = "2.0.x";

/**
 * Consolidation note: the donor carried four packages (ai-studio, opencode-gdevelop,
 * opencode-provider, unlock-shim). This pack merges the in-editor surface
 * (unlock-shim + opencode-gdevelop + ai-studio) into one boundary; the provider
 * bridge remains an optional subpath (`./provider-bridge`, BYOK only).
 */
export const CONSOLIDATED_MODULES = ["unlock-shim", "opencode-gdevelop", "ai-studio"] as const;
export const OPTIONAL_PROVIDER_BRIDGE = "./provider-bridge";

export async function ready(hostVersion: string): Promise<ReadyResult> {
  if (!hostSatisfiesCompat(HOST_COMPAT, hostVersion)) {
    return {
      status: "degraded",
      reason: `pack-gdevelop ${PACK_VERSION} requires host ${HOST_COMPAT}, got ${hostVersion}`,
    };
  }
  return { status: "ready" };
}

export const manifest = definePack({
  id: PACK_ID,
  version: PACK_VERSION,
  hostCompat: HOST_COMPAT,
  laneRequires: [{ capability: "gdevelop", image: "ghcr.io/heretek-opencode/lane-gdevelop:5.x" }],
  tools: [{ server: "./mcp/gdevelop.js", transport: "stdio" }],
  skills: ["./skills/gdevelop-byok.md"],
  commands: [{ name: "gdevelop.verify-patches", handler: "scripts.verifyPatches" }],
  providers: [OPTIONAL_PROVIDER_BRIDGE],
  ready,
});

export default manifest;
