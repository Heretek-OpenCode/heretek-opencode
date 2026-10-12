import { describe, expect, test } from "bun:test";
import {
  ExtractStructuredInputSchema,
  FetchInputSchema,
  FetchOutputSchema,
  ResearchReportInputSchema,
  ResearchReportOutputSchema,
  SearchInputSchema,
  SearchOutputSchema,
  parseToolInput,
  parseToolOutput,
} from "../src/schemas.js";
import { makeEnvelope } from "../src/sanitize.js";

describe("schemas round-trip", () => {
  test("search input clamps/defaults", () => {
    expect(SearchInputSchema.parse({ query: "q" })).toMatchObject({ query: "q", limit: 5 });
    expect(() => SearchInputSchema.parse({ query: "" })).toThrow();
    expect(() => SearchInputSchema.parse({ query: "q", limit: 21 })).toThrow();
  });

  test("fetch input requires url", () => {
    expect(FetchInputSchema.parse({ url: "https://example.com" })).toMatchObject({ format: "markdown" });
    expect(() => FetchInputSchema.parse({})).toThrow();
  });

  test("extract_structured + research_report inputs", () => {
    expect(ExtractStructuredInputSchema.parse({ url: "https://example.com" })).toMatchObject({ url: "https://example.com" });
    expect(ResearchReportInputSchema.parse({ query: "q" })).toMatchObject({ depth: "standard", maxSources: 5 });
    expect(() => ResearchReportInputSchema.parse({ query: "q", depth: "ultra" })).toThrow();
  });

  test("parseToolInput dispatches per tool", () => {
    expect(parseToolInput("search", { query: "q" })).toMatchObject({ query: "q" });
    expect(parseToolInput("fetch", { url: "https://example.com" })).toMatchObject({ format: "markdown" });
    expect(() => parseToolInput("search", { nope: 1 })).toThrow();
  });

  test("tool outputs round-trip through the envelope", () => {
    const env = makeEnvelope({ url: "https://example.com", engine: "crawl4ai", rawContent: "hello" });
    const fetchOut = {
      ...env,
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com",
      statusCode: 200,
      contentType: "text/markdown",
      title: "T",
      format: "markdown",
      bytes: 5,
      truncated: false,
    };
    expect(FetchOutputSchema.parse(fetchOut)).toMatchObject({ trust: "untrusted" });
    expect(parseToolOutput("fetch", fetchOut)).toMatchObject({ statusCode: 200 });

    const searchOut = {
      ...makeEnvelope({ url: "searxng://search?q=q", engine: "searxng", rawContent: "r" }),
      query: "q",
      results: [{ rank: 1, title: "t", url: "https://example.com", snippet: "s", engine: "searxng" }],
    };
    expect(SearchOutputSchema.parse(searchOut)).toMatchObject({ query: "q" });

    const reportOut = {
      ...makeEnvelope({ url: "gpt-researcher://report?q=q", engine: "gpt-researcher", rawContent: "rep" }),
      query: "q",
      depth: "deep",
      citations: [],
    };
    expect(ResearchReportOutputSchema.parse(reportOut)).toMatchObject({ depth: "deep" });
  });

  test("trust must be exactly 'untrusted'", () => {
    const env = makeEnvelope({ url: "https://example.com", engine: "e", rawContent: "x" });
    expect(() => SearchOutputSchema.parse({ ...env, trust: "trusted", query: "q", results: [] })).toThrow();
  });
});
