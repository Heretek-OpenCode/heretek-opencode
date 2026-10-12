import { accessSync, constants as fsConstants } from "node:fs";
import { join } from "node:path";

/**
 * Standardized readiness pattern (promoted from the opencode-rea donor):
 * check whether the REA MCP side is responsive and return ready|degraded
 * with actionable remediation. Advice strings only — never executed here.
 */

export const DOCTOR_CMD = "rea doctor --client opencode --json";
export const SETUP_CMD = "rea setup --client opencode --dry-run";

export interface ReaReadiness {
  status: "ready" | "degraded";
  reason?: string;
  remediation: string[];
}

export interface ReaReadinessOptions {
  /** Override the responsiveness probe (tests inject true/false here). */
  probe?: () => boolean | Promise<boolean>;
}

function defaultReaProbe(): boolean {
  const bunWhich = (globalThis as { Bun?: { which?: (cmd: string) => string | null } }).Bun?.which;
  if (typeof bunWhich === "function") {
    try {
      if (bunWhich("rea") !== null) return true;
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
        accessSync(join(dir, `rea${suffix}`), fsConstants.X_OK);
        return true;
      } catch {
        /* keep scanning */
      }
    }
  }
  return false;
}

export async function checkReaReadiness(
  opts: ReaReadinessOptions = {},
): Promise<ReaReadiness> {
  const probe = opts.probe ?? defaultReaProbe;
  if (await probe()) {
    return { status: "ready", remediation: [] };
  }
  return {
    status: "degraded",
    reason:
      "REA MCP server is not responsive: the `rea` CLI was not found on PATH, so no REA tools are reachable",
    remediation: [DOCTOR_CMD, SETUP_CMD],
  };
}
