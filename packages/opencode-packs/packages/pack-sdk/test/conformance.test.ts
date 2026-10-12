import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hostSatisfiesCompat,
  packConformance,
} from "../src/index";

import godotManifest, { ready as godotReady } from "../../../packs/pack-godot/src/index";
import { GODOT_TOOLS } from "../../../packs/pack-godot/src/tools";
import { guardTool } from "../../../packs/pack-godot/src/guard";
import gdevelopManifest, { ready as gdevelopReady } from "../../../packs/pack-gdevelop/src/index";
import reaManifest, { ready as reaReady } from "../../../packs/pack-rea/src/index";
import { checkReaReadiness } from "../../../packs/pack-rea/src/readiness";

const HOST = "2.0.26";

describe("packConformance", () => {
  test("passes for pack-godot", () => {
    const result = packConformance(godotManifest);
    expect({ result }).toEqual({ result: { pass: true, fail: [] } });
  });

  test("passes for pack-gdevelop", () => {
    expect(packConformance(gdevelopManifest)).toEqual({ pass: true, fail: [] });
  });

  test("passes for pack-rea", () => {
    expect(packConformance(reaManifest)).toEqual({ pass: true, fail: [] });
  });

  test("fails on missing ready() handshake", () => {
    const { ready: _drop, ...data } = godotManifest;
    const result = packConformance(data);
    expect(result.pass).toBe(false);
    expect(result.fail.some((f) => f.includes("ready"))).toBe(true);
  });

  test("fails on malformed hostCompat", () => {
    const result = packConformance({ ...godotManifest, hostCompat: "sometime-later" });
    expect(result.pass).toBe(false);
    expect(result.fail.some((f) => f.includes("hostCompat"))).toBe(true);
  });

  test("fails on empty hook handler", () => {
    const result = packConformance({ ...godotManifest, hooks: { toolGuard: "" } });
    expect(result.pass).toBe(false);
    expect(result.fail.some((f) => f.includes("toolGuard"))).toBe(true);
  });

  test("fails on laneRequires without an image ref", () => {
    const result = packConformance({
      ...godotManifest,
      laneRequires: [{ capability: "godot", image: "" }],
    });
    expect(result.pass).toBe(false);
    expect(result.fail.some((f) => f.includes("image"))).toBe(true);
  });

  test("fails on tool entry that does not JSON round-trip", () => {
    const result = packConformance({
      ...godotManifest,
      tools: [{ server: "./mcp/godot.js", transport: "stdio", schema: { n: 1n } }],
    });
    expect(result.pass).toBe(false);
    expect(result.fail.some((f) => f.includes("round-trip"))).toBe(true);
  });

  test("fails on an invalid manifest body", () => {
    const result = packConformance({ ...godotManifest, id: "" });
    expect(result.pass).toBe(false);
    expect(result.fail.some((f) => f.includes("manifest invalid"))).toBe(true);
  });
});

describe("hostSatisfiesCompat", () => {
  test("x-range, exact, caret, tilde, star", () => {
    expect(hostSatisfiesCompat("2.0.x", "2.0.26")).toBe(true);
    expect(hostSatisfiesCompat("2.0.x", "2.1.0")).toBe(false);
    expect(hostSatisfiesCompat("2.0.26", "2.0.26")).toBe(true);
    expect(hostSatisfiesCompat("2.0.26", "2.0.27")).toBe(false);
    expect(hostSatisfiesCompat("^2.0.0", "2.9.0")).toBe(true);
    expect(hostSatisfiesCompat("^2.0.0", "3.0.0")).toBe(false);
    expect(hostSatisfiesCompat("~2.0.0", "2.0.9")).toBe(true);
    expect(hostSatisfiesCompat("~2.0.0", "2.1.0")).toBe(false);
    expect(hostSatisfiesCompat("*", "9.9.9")).toBe(true);
    expect(hostSatisfiesCompat("bogus", HOST)).toBe(false);
    expect(hostSatisfiesCompat("2.0.x", "not-a-version")).toBe(false);
  });
});

describe("ready() handshakes", () => {
  test("godot: ready when host matches and binary present", async () => {
    expect(await godotReady(HOST, { probeGodot: () => true })).toEqual({ status: "ready" });
  });

  test("godot: degraded on host mismatch", async () => {
    const r = await godotReady("1.9.0", { probeGodot: () => true });
    expect(r.status).toBe("degraded");
    expect(r.reason).toContain("1.9.0");
  });

  test("godot: degraded with reason when binary missing", async () => {
    const r = await godotReady(HOST, { probeGodot: () => false });
    expect(r.status).toBe("degraded");
    expect(r.reason).toContain("godot binary");
  });

  test("gdevelop: ready on matching host, degraded otherwise", async () => {
    expect(await gdevelopReady(HOST)).toEqual({ status: "ready" });
    const r = await gdevelopReady("3.0.0");
    expect(r.status).toBe("degraded");
    expect(r.reason).toContain("3.0.0");
  });

  test("rea: ready when host matches and REA responsive", async () => {
    expect(await reaReady(HOST, { rea: { probe: () => true } })).toEqual({ status: "ready" });
  });

  test("rea: degraded with actionable remediation when REA missing", async () => {
    const r = await reaReady(HOST, { rea: { probe: () => false } });
    expect(r.status).toBe("degraded");
    expect(r.reason).toContain("rea doctor");
    expect(r.reason).toContain("rea setup");
  });

  test("rea: degraded on host mismatch without probing REA", async () => {
    let probed = false;
    const r = await reaReady("1.0.0", {
      rea: {
        probe: () => {
          probed = true;
          return true;
        },
      },
    });
    expect(r.status).toBe("degraded");
    expect(probed).toBe(false);
  });

  test("checkReaReadiness returns remediation advice only (never throws)", async () => {
    const r = await checkReaReadiness({ probe: () => false });
    expect(r.status).toBe("degraded");
    expect(r.remediation.length).toBeGreaterThan(0);
  });
});

describe("godot tool stubs", () => {
  test("tool defs JSON round-trip and guard allows only godot.*", () => {
    for (const tool of GODOT_TOOLS) {
      expect(JSON.parse(JSON.stringify(tool))).toEqual(tool);
      expect(tool.name.startsWith("godot.")).toBe(true);
    }
    expect(guardTool("godot.openScene").allow).toBe(true);
    expect(guardTool("fetch.raw").allow).toBe(false);
  });
});

describe("@opencode/* version pins", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const packsDir = join(testDir, "..", "..", "..", "packs");
  const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

  for (const pack of ["pack-godot", "pack-gdevelop", "pack-rea"]) {
    test(`${pack}: every @opencode/* dep is exactly 2.0.26`, () => {
      const pkg = JSON.parse(readFileSync(join(packsDir, pack, "package.json"), "utf8")) as Record<
        string,
        Record<string, string> | undefined
      >;
      const pins: Array<[string, string, string]> = [];
      for (const section of sections) {
        for (const [name, version] of Object.entries(pkg[section] ?? {})) {
          if (name.startsWith("@opencode/")) pins.push([section, name, version]);
        }
      }
      expect(pins.length).toBeGreaterThan(0);
      for (const [section, name, version] of pins) {
        expect(version, `${pack} ${section}:${name}`).toBe("2.0.26");
      }
    });
  }
});
