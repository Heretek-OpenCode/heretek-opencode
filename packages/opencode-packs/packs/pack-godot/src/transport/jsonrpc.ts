// JSON-RPC 2.0 engine for the Godot bridge (zero-Python).
// Strict parsing with a 4 MiB frame ceiling; corrupted frames throw.

export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcErrorResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type ParsedMessage =
  | {
      readonly kind: "request";
      readonly id: JsonRpcId;
      readonly method: string;
      readonly params?: unknown;
    }
  | {
      readonly kind: "notification";
      readonly method: string;
      readonly params?: unknown;
    }
  | {
      readonly kind: "response";
      readonly id: JsonRpcId;
      readonly result: unknown;
    }
  | {
      readonly kind: "error";
      readonly id: JsonRpcId;
      readonly code: number;
      readonly message: string;
      readonly data?: unknown;
    };

export class JsonRpcFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonRpcFrameError";
  }
}

let nextId = 1;
export function nextRequestId(): number {
  return nextId++;
}

export function createRequest(
  method: string,
  params?: unknown,
  id?: JsonRpcId,
): JsonRpcRequest {
  if (!method || typeof method !== "string")
    throw new JsonRpcFrameError("method must be a non-empty string");
  return {
    jsonrpc: "2.0",
    id: id ?? nextRequestId(),
    method,
    ...(params === undefined ? {} : { params }),
  };
}

export function createNotification(
  method: string,
  params?: unknown,
): JsonRpcNotification {
  if (!method || typeof method !== "string")
    throw new JsonRpcFrameError("method must be a non-empty string");
  return {
    jsonrpc: "2.0",
    method,
    ...(params === undefined ? {} : { params }),
  };
}

export function createResponse(
  id: JsonRpcId,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function assertId(id: unknown): asserts id is JsonRpcId {
  if (typeof id !== "number" && typeof id !== "string") {
    throw new JsonRpcFrameError("id must be number|string");
  }
  if (id === null) throw new JsonRpcFrameError("id must not be null");
}

export function parseFrame(
  text: string,
  maxBytes: number = MAX_FRAME_BYTES,
): unknown {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) {
    throw new JsonRpcFrameError(
      `frame exceeds ${maxBytes} byte ceiling (${bytes} bytes)`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new JsonRpcFrameError("frame is not valid JSON");
  }
}

export function parseMessage(
  text: string,
  maxBytes: number = MAX_FRAME_BYTES,
): ParsedMessage {
  const data = parseFrame(text, maxBytes) as Record<string, unknown>;
  if (!data || typeof data !== "object" || data.jsonrpc !== "2.0") {
    throw new JsonRpcFrameError("message must be JSON-RPC 2.0");
  }
  const hasId = "id" in data;
  const hasMethod = "method" in data;
  if (hasMethod) {
    if (typeof data.method !== "string" || !data.method) {
      throw new JsonRpcFrameError("method must be a non-empty string");
    }
    if (hasId) {
      assertId(data.id);
      return {
        kind: "request",
        id: data.id,
        method: data.method,
        params: data.params,
      };
    }
    return { kind: "notification", method: data.method, params: data.params };
  }
  if (!hasId) throw new JsonRpcFrameError("response must carry an id");
  assertId(data.id);
  if ("error" in data && data.error !== undefined) {
    const err = data.error as {
      code?: unknown;
      message?: unknown;
      data?: unknown;
    };
    if (
      typeof err !== "object" ||
      err === null ||
      typeof err.code !== "number" ||
      typeof err.message !== "string"
    ) {
      throw new JsonRpcFrameError(
        "error must carry numeric code and string message",
      );
    }
    return {
      kind: "error",
      id: data.id,
      code: err.code,
      message: err.message,
      data: err.data,
    };
  }
  if (!("result" in data))
    throw new JsonRpcFrameError("response must carry result or error");
  return { kind: "response", id: data.id, result: data.result };
}
