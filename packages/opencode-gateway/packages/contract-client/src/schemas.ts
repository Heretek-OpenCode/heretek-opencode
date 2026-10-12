import { z } from "zod";

/** Wire contract version. Every POST /mcp response carries `X-Swarm-Contract: 1`. */
export const CONTRACT_VERSION = 1 as const;
export const CONTRACT_HEADER = "X-Swarm-Contract";
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", MCP_PROTOCOL_VERSION] as const;

// ---------------------------------------------------------------------------
// Tool inputs
// ---------------------------------------------------------------------------

export const SearchInputSchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(20).default(5),
});
export type SearchInput = z.infer<typeof SearchInputSchema>;

export const FetchInputSchema = z.object({
  url: z.string().min(1).max(2048),
  format: z.enum(["markdown", "html", "text"]).default("markdown"),
});
export type FetchInput = z.infer<typeof FetchInputSchema>;

export const ExtractStructuredInputSchema = z.object({
  url: z.string().min(1).max(2048),
  fields: z.array(z.string().min(1).max(128)).max(64).optional(),
  schema: z.record(z.any()).optional(),
});
export type ExtractStructuredInput = z.infer<typeof ExtractStructuredInputSchema>;

export const ResearchReportInputSchema = z.object({
  query: z.string().min(1).max(2000),
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
  maxSources: z.number().int().min(1).max(20).default(5),
});
export type ResearchReportInput = z.infer<typeof ResearchReportInputSchema>;

export const TOOL_NAMES = ["search", "fetch", "extract_structured", "research_report"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function parseToolInput(name: ToolName, args: unknown): SearchInput | FetchInput | ExtractStructuredInput | ResearchReportInput {
  switch (name) {
    case "search":
      return SearchInputSchema.parse(args);
    case "fetch":
      return FetchInputSchema.parse(args);
    case "extract_structured":
      return ExtractStructuredInputSchema.parse(args);
    case "research_report":
      return ResearchReportInputSchema.parse(args);
  }
}

// ---------------------------------------------------------------------------
// Provenance envelope: every web-derived payload returned to an LLM.
// ---------------------------------------------------------------------------

export const ProvenanceSchema = z.object({
  url: z.string(),
  fetchedAt: z.string(),
  engine: z.string(),
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const EnvelopeSchema = z.object({
  provenance: ProvenanceSchema,
  trust: z.literal("untrusted"),
  content: z.string(),
});
export type UntrustedEnvelope = z.infer<typeof EnvelopeSchema>;

// ---------------------------------------------------------------------------
// Tool outputs (structuredContent = envelope fields + tool extras)
// ---------------------------------------------------------------------------

export const SearchResultItemSchema = z.object({
  rank: z.number().int().min(1),
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  engine: z.string(),
});
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;

export const SearchOutputSchema = EnvelopeSchema.extend({
  query: z.string(),
  results: z.array(SearchResultItemSchema),
  cached: z.boolean().optional(),
});
export type SearchOutput = z.infer<typeof SearchOutputSchema>;

export const FetchOutputSchema = EnvelopeSchema.extend({
  requestedUrl: z.string(),
  finalUrl: z.string(),
  statusCode: z.number().int(),
  contentType: z.string().nullable(),
  title: z.string().nullable(),
  format: z.enum(["markdown", "html", "text"]),
  bytes: z.number().int().min(0),
  truncated: z.boolean(),
  cached: z.boolean().optional(),
});
export type FetchOutput = z.infer<typeof FetchOutputSchema>;

export const ExtractStructuredOutputSchema = EnvelopeSchema.extend({
  requestedUrl: z.string(),
  data: z.record(z.any()),
  fields: z.array(z.string()),
  cached: z.boolean().optional(),
});
export type ExtractStructuredOutput = z.infer<typeof ExtractStructuredOutputSchema>;

export const ReportCitationSchema = z.object({
  url: z.string(),
  title: z.string(),
  contentHash: z.string(),
});
export type ReportCitation = z.infer<typeof ReportCitationSchema>;

export const ResearchReportOutputSchema = EnvelopeSchema.extend({
  query: z.string(),
  depth: z.enum(["quick", "standard", "deep"]),
  citations: z.array(ReportCitationSchema),
  cached: z.boolean().optional(),
});
export type ResearchReportOutput = z.infer<typeof ResearchReportOutputSchema>;

export const TOOL_OUTPUT_SCHEMAS = {
  search: SearchOutputSchema,
  fetch: FetchOutputSchema,
  extract_structured: ExtractStructuredOutputSchema,
  research_report: ResearchReportOutputSchema,
} as const;

export function parseToolOutput(name: ToolName, value: unknown) {
  return TOOL_OUTPUT_SCHEMAS[name].parse(value);
}

// Machine-readable error envelope (execution failures ride isError).
export const ErrorStructuredSchema = z.object({
  code: z.enum([
    "invalid_params",
    "ssrf_denied",
    "blocked_by_policy",
    "upstream_error",
    "upstream_timeout",
    "rate_limited",
    "scope_denied",
    "engine_unavailable",
  ]),
  message: z.string(),
  retryAfterS: z.number().int().min(0).nullable().default(null),
});
export type ErrorStructured = z.infer<typeof ErrorStructuredSchema>;

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 wire envelope
// ---------------------------------------------------------------------------

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.any()).optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcResultSchema = z
  .object({
    // tools/call results carry content + structuredContent; initialize and
    // tools/list carry their own shapes (protocolVersion/serverInfo, tools).
    content: z.array(z.object({ type: z.literal("text"), text: z.string() })).optional(),
    structuredContent: z.record(z.any()).optional(),
    isError: z.boolean().optional(),
  })
  .passthrough();
export type JsonRpcResult = z.infer<typeof JsonRpcResultSchema>;

export const JsonRpcSuccessSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: JsonRpcResultSchema,
});
export type JsonRpcSuccess = z.infer<typeof JsonRpcSuccessSchema>;

export const JsonRpcErrorSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  error: z.object({ code: z.number().int(), message: z.string() }),
});
export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;

// ---------------------------------------------------------------------------
// Golden fixture shape: contract/v1/fixtures/<tool>/<case>.json
// ---------------------------------------------------------------------------

export const FixtureSchema = z.object({
  contract_version: z.literal(1),
  request: z.record(z.any()),
  response_status: z.number().int(),
  response_headers: z.record(z.string()),
  response_body: z.record(z.any()),
});
export type GoldenFixture = z.infer<typeof FixtureSchema>;
