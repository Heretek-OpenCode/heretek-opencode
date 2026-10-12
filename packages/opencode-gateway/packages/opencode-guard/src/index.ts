/**
 * @heretek-ai/gateway-guard — OpenCode v2 plugin (against @opencode/plugin 2.0.26 exact).
 *
 * - `tool.hook("execute.before")`: blocks raw network tools toward arbitrary
 *   URLs (gateway host allowlisted); throws to deny.
 * - `mcp.transform`: registers the hardened gateway as MCP server `gateway`.
 * - `tool.transform`: namespaces third-party raw-fetch tools so the guard's
 *   hook sees them under stable ids (defense in depth; never silently drops).
 *
 * Enforcement backstop: lane egress policy (network=none except gateway).
 * See README.md ("Fallback to lane egress policy").
 */
import { Plugin } from "@opencode/plugin";
import { allowedHostsFor, decideToolExecution, defaultGatewayUrl } from "./guard.js";

const GATEWAY_URL = defaultGatewayUrl();
const MCP_URL = `${GATEWAY_URL.replace(/\/+$/, "")}/mcp`;

export default Plugin.define({
  id: "gateway-guard",
  setup: async (ctx: Plugin.Context) => {
    const allowed = allowedHostsFor({ gatewayUrl: GATEWAY_URL });

    // 1. Register the hardened gateway as an MCP server so agents get the
    // typed tools (search, fetch, extract_structured, research_report).
    await ctx.mcp.transform((editor) => {
      editor.set("gateway", {
        type: "remote",
        url: MCP_URL,
      });
    });

    // 2. Block raw network tools toward arbitrary URLs.
    await ctx.tool.hook("execute.before", async (input) => {
      const tool = (input as { tool?: unknown }).tool;
      const args = (input as { input?: unknown }).input ?? {};
      const decision = decideToolExecution(typeof tool === "string" ? tool : "", args, {
        allowedHosts: allowed,
        gatewayUrl: GATEWAY_URL,
      });
      if (decision.blocked) throw new Error(decision.message ?? "blocked by gateway guard");
    });

    // 3. Namespace third-party raw-fetch tools (stable ids for the hook).
    await ctx.tool.transform((editor) => {
      for (const t of editor.list()) {
        const name = t.id.toLowerCase();
        if (name.includes("webfetch") && !name.startsWith("gateway")) {
          editor.namespace({ name: "raw", description: "Third-party raw network tools (gateway-guarded)" });
          break;
        }
      }
    });
  },
});
