import { describe, expect, test } from "bun:test";
import { allowedHostsFor, decideToolExecution, extractHosts, isBlockedToolName } from "../src/guard.js";

const GW = { gatewayUrl: "http://gateway:8000", allowedHosts: ["gateway"] };

describe("gateway guard", () => {
  test("blocks raw fetch toward arbitrary URLs", () => {
    for (const tool of ["webfetch", "fetch", "http", "curl", "Curl", "CURL", "wget"]) {
      const d = decideToolExecution(tool, { url: "https://example.com" }, GW);
      expect(d.blocked, tool).toBe(true);
      expect(d.message).toMatch(/gateway MCP tools/);
    }
  });

  test("allowlist: fetch-class tools pointed solely at the gateway pass", () => {
    const d = decideToolExecution("fetch", { url: "http://gateway:8000/mcp" }, GW);
    expect(d.blocked).toBe(false);
  });

  test("blocks interpreter exfil primitives, allows plain tools", () => {
    for (const tool of ["python", "python3", "powershell", "pwsh", "ruby", "node", "nc"]) {
      expect(decideToolExecution(tool, { command: "x" }, GW).blocked, tool).toBe(true);
    }
    expect(decideToolExecution("read", { path: "main.py" }, GW).blocked).toBe(false);
  });

  test("shell with fetch intent toward arbitrary hosts blocked; plain shell passes", () => {
    expect(decideToolExecution("bash", { command: "curl https://example.com/x" }, GW).blocked).toBe(true);
    expect(decideToolExecution("bash", { command: "ls -la" }, GW).blocked).toBe(false);
    expect(decideToolExecution("bash", { command: "curl http://gateway:8000/mcp" }, GW).blocked).toBe(false);
  });

  test("block message never echoes URLs (secret-bearing queries)", () => {
    const d = decideToolExecution("fetch", { url: "https://example.com/?token=SECRET123" }, GW);
    expect(d.blocked).toBe(true);
    expect(d.message).not.toContain("SECRET123");
  });

  test("hosts extracted from args; allowlist derived from gateway URL", () => {
    expect(extractHosts({ url: "https://example.com/a?x=1" })).toEqual(["example.com"]);
    expect(allowedHostsFor({ gatewayUrl: "http://gateway:8000" })).toEqual(["gateway"]);
    expect(isBlockedToolName("Web_Fetch")).toBe(true);
    expect(isBlockedToolName("read")).toBe(false);
  });
});
