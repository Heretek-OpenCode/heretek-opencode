import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRACT_VERSION,
  ErrorStructuredSchema,
  FetchOutputSchema,
  FixtureSchema,
  JsonRpcErrorSchema,
  JsonRpcSuccessSchema,
  ResearchReportOutputSchema,
  SearchOutputSchema,
  ExtractStructuredOutputSchema,
} from "../src/schemas.js";
import { loadAllFixtures } from "../src/fixtures.js";
import { verifyContentHash } from "../src/sanitize.js";

const FIXTURE_DIR = join(import.meta.dir, "..", "..", "..", "contract", "v1", "fixtures");

describe("fixture-vs-schema conformance", () => {
  test("fixture directory exists and is non-empty", () => {
    expect(readdirSync(FIXTURE_DIR).length).toBeGreaterThan(0);
  });

  test("every fixture validates against FixtureSchema + carries the contract header", () => {
    const fixtures = loadAllFixtures(FIXTURE_DIR);
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    for (const f of fixtures) {
      expect(() => FixtureSchema.parse(f)).not.toThrow();
      expect(f.contract_version).toBe(CONTRACT_VERSION);
      expect(f.response_headers["x-swarm-contract"]).toBe(String(CONTRACT_VERSION));
      expect(f.response_headers["content-type"]).toBe("application/json");
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("success tool fixtures validate against their output schemas, hashes verify", () => {
    const fixtures = loadAllFixtures(FIXTURE_DIR);
    const byFile = new Map(fixtures.map((f) => [f.file, f]));
    const successCases: Array<[string, (v: unknown) => unknown]> = [
      ["search/success.json", (v) => SearchOutputSchema.parse(v)],
      ["fetch/success.json", (v) => FetchOutputSchema.parse(v)],
      ["extract_structured/success.json", (v) => ExtractStructuredOutputSchema.parse(v)],
      ["research_report/success.json", (v) => ResearchReportOutputSchema.parse(v)],
    ];
    for (const [rel, parse] of successCases) {
      const match = [...byFile.entries()].find(([file]) => file.endsWith(rel));
      expect(match, `missing fixture ${rel}`).toBeDefined();
      const body = match![1].response_body;
      const rpc = JsonRpcSuccessSchema.parse(body);
      expect(rpc.result.isError).not.toBe(true);
      expect(rpc.result.structuredContent).toBeDefined();
      const out = parse(rpc.result.structuredContent) as { provenance: { contentHash: string }; content: string };
      expect(verifyContentHash(out.content, out.provenance.contentHash)).toBe(true);
    }
  });

  test("error fixtures carry machine-readable codes, 429 carries retry-after", () => {
    const fixtures = loadAllFixtures(FIXTURE_DIR);
    const find = (rel: string) => {
      const m = fixtures.find((f) => f.file.endsWith(rel));
      expect(m, `missing fixture ${rel}`).toBeDefined();
      return m!;
    };
    for (const rel of ["search/upstream-error.json", "fetch/ssrf-denied.json", "extract_structured/upstream-error.json"]) {
      const f = find(rel);
      const rpc = JsonRpcSuccessSchema.parse(f.response_body);
      expect(rpc.result.isError).toBe(true);
      expect(() => ErrorStructuredSchema.parse(rpc.result.structuredContent)).not.toThrow();
    }
    const limited = find("research_report/rate-limited.json");
    expect(limited.response_status).toBe(429);
    expect(limited.response_headers["retry-after"]).toBeDefined();
  });

  test("initialize + tools-list fixtures preserve wire compat", () => {
    const fixtures = loadAllFixtures(FIXTURE_DIR);
    const find = (rel: string) => {
      const m = fixtures.find((f) => f.file.endsWith(rel));
      expect(m, `missing fixture ${rel}`).toBeDefined();
      return m!;
    };
    const init = JsonRpcSuccessSchema.parse(find("initialize/success.json").response_body);
    const serverInfo = (init.result as unknown as { serverInfo: { contractVersion: number } }).serverInfo;
    expect(serverInfo.contractVersion).toBe(CONTRACT_VERSION);
    const toolsList = JsonRpcSuccessSchema.parse(find("tools-list/full.json").response_body);
    const tools = (toolsList.result as unknown as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["extract_structured", "fetch", "research_report", "search"]);
    // Transport-level error shape still parses.
    expect(() => JsonRpcErrorSchema.parse({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "x" } })).not.toThrow();
  });
});
