import {
  definePack,
  hostSatisfiesCompat,
  type ReadyResult,
} from "../../../packages/pack-sdk/src/index";
import { checkReaReadiness, type ReaReadinessOptions } from "./readiness";

export const PACK_ID = "rea";
export const PACK_VERSION = "1.0.0";
export const HOST_COMPAT = "2.0.x";

export interface ReaReadyOptions {
  rea?: ReaReadinessOptions;
}

export async function ready(hostVersion: string, opts: ReaReadyOptions = {}): Promise<ReadyResult> {
  if (!hostSatisfiesCompat(HOST_COMPAT, hostVersion)) {
    return {
      status: "degraded",
      reason: `pack-rea ${PACK_VERSION} requires host ${HOST_COMPAT}, got ${hostVersion}`,
    };
  }
  const rea = await checkReaReadiness(opts.rea);
  if (rea.status !== "ready") {
    return {
      status: "degraded",
      reason: `${rea.reason}; remediation: ${rea.remediation.join(" | ")}`,
    };
  }
  return { status: "ready" };
}

export const manifest = definePack({
  id: PACK_ID,
  version: PACK_VERSION,
  hostCompat: HOST_COMPAT,
  tools: [{ server: "./mcp/rea.js", transport: "stdio" }],
  agents: ["./agents/rea-analyst.md", "./agents/rea-investigator.md"],
  skills: ["./skills/rea-readiness.md", "./skills/rea-evidence.md"],
  commands: [{ name: "rea.check-readiness", handler: "readiness.checkReaReadiness" }],
  ready,
});

export { checkReaReadiness };
export default manifest;
